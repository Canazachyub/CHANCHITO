# Chanchito v2 — Bot de Telegram

Guía operativa del bot: cómo crearlo, cómo registrar el webhook, cómo conseguir
la API key de Gemini, y cómo funcionan por dentro los flujos de conversación.
Normativo: `docs/CONTRACT.md` §5. Código: `backend/40_telegram.js`,
`backend/41_gemini.js`, `backend/42_telegram_teclados.js`, `backend/50_triggers.js`.

---

## 1. Crear el bot en @BotFather

1. Abrir una conversación con [@BotFather](https://t.me/BotFather) en Telegram.
2. `/newbot` → elegir un nombre visible y un username terminado en `bot`
   (ej. `ChanchitoFamiliaBot`).
3. BotFather devuelve el **token** (`123456:ABC-...`). Guardarlo en
   `PropertiesService` del proyecto de Apps Script como `TELEGRAM_BOT_TOKEN`
   (Extensiones → Propiedades del proyecto → Propiedades del script). **Nunca**
   en el código fuente que se sube a GitHub.
4. Opcional pero recomendado: `/setdescription`, `/setuserpic`,
   `/setcommands` con esta lista (coincide con `CONTRACT.md` §5):

   ```
   start - Vincular tu cuenta o saludo
   gasto - Registrar un gasto: /gasto 45.90 almuerzo
   ingreso - Registrar un ingreso: /ingreso 1500 sueldo
   balance - Balance del mes en curso (pide el espacio)
   deudas - Ver deudas pendientes (pide el espacio)
   solicitar - Pedir plata: /solicitar 150 materiales para la obra
   solicitudes - Ver tus solicitudes (o las pendientes, si sos propietario)
   obligaciones - Obligaciones del mes y si ya se generaron
   agregar - (solo propietario) Alta de usuario
   quitar - (solo propietario) Baja de usuario
   cancelar - Cancelar la operación en curso
   ```

---

## 2. Registrar el webhook

Generar un secreto propio (`openssl rand -hex 32`) y guardarlo en
`PropertiesService` como `TELEGRAM_WEBHOOK_SECRET`. El webhook apunta a la Web App
desplegada, con `action=telegramWebhook` y **ese secreto** en la URL:

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=telegramWebhook&secreto=<TELEGRAM_WEBHOOK_SECRET>
```

En la URL va el secreto del webhook y **no** el `SHARED_TOKEN`: esa URL queda
guardada en los servidores de Telegram, y no hay razón para dejar ahí el token que
abre el resto de la API. Si el secreto se filtra, se rota solo, sin tocar la app.

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
        "url": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=telegramWebhook&secreto=<TELEGRAM_WEBHOOK_SECRET>",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
        "allowed_updates": ["message", "callback_query"]
      }'
```

Verificar que quedó registrado:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

### ⚠️ Limitación conocida de Apps Script con el header del secreto

`CONTRACT.md` §3 exige validar el header `X-Telegram-Bot-Api-Secret-Token`
que Telegram manda en cada request al webhook. **Apps Script (`ContentService`
Web App) no expone headers HTTP arbitrarios en `doPost(e)`** — no hay forma
documentada de leerlos directamente desde `e`. `manejarTelegramWebhook` en
`backend/40_telegram.js` (función `tgSecretoValido`) intenta leer
`e.headers` por si Apps Script llega a exponerlos en algún momento, pero mientras
tanto el gate real es `?secreto=<TELEGRAM_WEBHOOK_SECRET>` en la URL, que sí es
accesible vía `e.parameter.secreto`. Registrar igual el `secret_token` en
`setWebhook` no hace daño y deja lista la validación estricta si en el futuro se
resuelve la limitación (por ejemplo, con un proxy liviano delante de la Web App que
sí reenvíe headers).

Consecuencia práctica: **la URL del webhook es la credencial** — tratarla como
secreta y no pegarla en capturas, issues ni chats.

---

## 3. API key de Gemini

1. Ir a [Google AI Studio](https://aistudio.google.com/app/apikey).
2. "Create API key" (puede asociarse al mismo proyecto de Google Cloud que
   usa el Spreadsheet, o a uno nuevo).
3. Guardar la key en `PropertiesService` como `GEMINI_API_KEY`. Nunca en el
   código fuente.
4. El bot usa el modelo `gemini-2.0-flash` (soporte de visión + JSON
   estructurado vía `responseSchema`). No requiere habilitar facturación para
   el uso normal de un grupo de ~10 personas dentro de la capa gratuita, pero
   conviene revisar cuotas en AI Studio si el volumen de fotos crece.

---

## 4. Configurar los triggers diarios

Una sola vez después de desplegar (o cada vez que se quiera "resetear" los
triggers), ejecutar manualmente desde el editor de Apps Script:

```
configurarTriggersChanchito()
```

Es idempotente: borra sus propios triggers antes de recrearlos. Crea:

| Función | Hora | Qué hace |
|---|---|---|
| `tgTriggerGastosRecurrentes` | 06:00 | Valida el monto de cada gasto recurrente vencido y delega la ejecución a `ejecutarGastoRecurrente` (`backend/19_recurrentes.js`). |
| `tgTriggerPresupuestos` | 08:00 | Notifica (canal `app`) cuando `getProgresoPresupuesto` (`backend/18_presupuestos.js`) indica que un presupuesto llegó a su `alerta_porcentaje` o se excedió. |
| `tgTriggerRecordatorioDeudas` | 09:00 | Deudas `pendiente` con vencimiento a ≤3 días: notificación interna (canal `telegram`) + `sendMessage` directo si el usuario tiene `telegram_chat_id`. |

---

## 5. Diagrama de los flujos de conversación

### 5.1 Vinculación (`/start`)

```
Usuario           Bot
  |  /start         |
  |----------------->|
  |                  |-- ¿chat_id ya vinculado a un Usuario activo?
  |                  |
  |     [sí]         |
  |<-- "Hola <nombre>, ya estás vinculado" --|
  |                  |
  |     [no]         |
  |<-- "Mandame tu email" --| (estado: esperando_email)
  |  email            |
  |----------------->|
  |                  |-- ¿existe en Usuarios con activo=true?
  |     [sí]          |
  |<-- "Listo, quedaste vinculado" --| (guarda telegram_chat_id)
  |     [no]          |
  |<-- "No autorizado, pedile acceso al administrador" --| (sigue esperando email)
```

### 5.2 Registro por foto (el flujo principal)

Dos espacios compartidos, `ESP_FAMILIA` y `ESP_TELCOM` (`CONTRACT.md` §0.3):
el bot pregunta **primero el espacio, antes que el usuario**, porque la
categoría (y la cuenta por defecto) dependen de él. Un gasto de la empresa
en el libro de la casa es el peor error que puede cometer este bot, así que
el espacio nunca se asume en silencio: se muestra el último usado por ese
`chat_id` primero, pero siempre hay que confirmarlo con un toque.

```
Usuario                          Bot                              Gemini
  | foto del voucher               |                                 |
  |-------------------------------->|                                 |
  |<-- sendChatAction typing +      |                                 |
  |    "Leyendo el voucher..." -----|                                 |
  |                                 |-- getFile + descarga blob        |
  |                                 |-- categorías de gasto, UNIÓN de -->|
  |                                 |   Familia + Telcom (todavía no    |
  |                                 |   se sabe el espacio)             |
  |                                 |-- imagen + prompt + schema ----->|
  |                                 |<-- {monto, comercio, fecha,      |
  |                                 |     categoria_sugerida,          |
  |                                 |     confianza} ------------------|
  |                                 |
  |            [monto ilegible o Gemini falló del todo]
  |<-- "No pude leer el monto, ¿cuánto fue?" --| (estado: esperando_monto_corregido)
  |  45.90                          |
  |-------------------------------->| (retoma el flujo normal)
  |
  |<-- resumen + botones [🏠 Familia][🏢 Telcom] --| (estado: esperando_espacio,
  |                                                    último usado primero)
  |  toca [🏢 Telcom]                |
  |-------------------------------->| callback_data: e:<idx>
  |                                 |-- la categoría sugerida se resuelve
  |                                 |   recién ahora contra la lista REAL
  |                                 |   de Telcom; si Gemini sugirió algo
  |                                 |   de Familia, no hay match y no se
  |                                 |   preselecciona nada
  |<-- resumen + botones [Usuario A][Usuario B]... --| (estado: esperando_usuario)
  |  toca [Usuario B]                |
  |-------------------------------->| callback_data: u:<idx>
  |<-- resumen + botones de categoría de Telcom (✓ sugerida primero si aplica) --| (estado: esperando_categoria)
  |  toca [✓ Notaría y trámites]     |
  |-------------------------------->| callback_data: c:<idx>
  |<-- resumen + [✅ Guardar][✏️ Corregir monto][❌ Cancelar] --| (estado: esperando_confirmacion)
  |  toca [✅ Guardar]               |
  |-------------------------------->| callback_data: ok
  |                                 |-- SOLO ACÁ: crearTransaccion(id_espacio=ESP_TELCOM, origen=bot_foto)
  |                                 |   + descarga la foto otra vez + subirEvidencia
  |<-- "✅ Guardado." + resumen -----|
```

El flujo por texto (`/gasto <monto> <descripción>`, `/ingreso ...`) es
idéntico desde el paso "resumen + botones de espacio": no pasa por Gemini,
arma el borrador directo del texto del comando (sin categoría sugerida).

`/balance` y `/deudas` también preguntan primero el espacio (con el mismo
recordatorio del último usado) y después responden editando ese mismo
mensaje, sin pasos adicionales.

### 5.3 Solicitudes de dinero (`/solicitar`, `/solicitudes`)

Flujo corto a propósito (`CONTRACT.md` §4-bis): espacio → categoría → se
crea de una vez y se avisa al propietario. No hay pantalla extra de
confirmación como en gasto/ingreso.

```
Usuario                          Bot                              Propietario
  | /solicitar 150 materiales      |                                 |
  |-------------------------------->|                                 |
  |<-- resumen + [🏠 Familia][🏢 Telcom] --| (estado: esperando_espacio_solicitud)
  |  toca [🏢 Telcom]                |
  |-------------------------------->| callback_data: e:<idx>
  |<-- resumen + botones de categoría de Telcom --| (estado: esperando_categoria_solicitud)
  |  toca [Materiales de trabajo]    |
  |-------------------------------->| callback_data: c:<idx>
  |                                 |-- crearSolicitud(...) — SOLO ACÁ se escribe
  |<-- "✅ Solicitud enviada. Esperá la aprobación." --|
  |                                 |-- sendMessage con los datos y ------>|
  |                                 |   [✅ Aprobar][❌ Rechazar] ---------->|
  |                                 |                                 |  toca [✅ Aprobar]
  |                                 |<--------------------------------------|
  |                                 |-- responderSolicitud({aprobar:true}) |
  |                                 |   crea el gasto de una vez            |
  |                                 |-- edita el mensaje del propietario:   |
  |                                 |   saca los botones, muestra el       |
  |                                 |   estado final (evita el doble toque) |
  |<-- "✅ Te aprobaron la solicitud..." --|                                |
```

Los botones `[✅ Aprobar] [❌ Rechazar]` viajan en un mensaje aparte al
`telegram_chat_id` del propietario, **fuera** de la máquina de estados
conversacional del bot (el propietario puede estar respondiendo eso a mitad
de cualquier otra cosa). El callback se rutea por prefijo (`sap:`/`srj:`)
antes de leer el estado del chat. Un segundo toque sobre el mismo botón
llega a un mensaje que ya no tiene botones (se editaron a `[]` al responder
la primera vez); si igual llegara un callback viejo, `responderSolicitud`
lo rechaza con `SOLICITUD_YA_RESPONDIDA` y el mensaje se edita mostrando eso
en vez de reintentar.

`/solicitudes` no pide espacio: consulta los dos y arma la lista.
Propietario → las pendientes de responder de ambos espacios, cada una con
sus botones (por si se perdió el aviso original). Miembro → las propias,
con ícono de espacio y estado (⏳ solicitada / ✅ aprobada / ❌ rechazada).

### 5.4 Obligaciones mensuales (`/obligaciones`)

Solo lectura, sin botones: consulta `getObligaciones` en los dos espacios y
arma un bloque por espacio con el concepto, el monto estimado, el día de
vencimiento, y si el período actual (`yyyy-MM`) ya coincide con
`ultimo_periodo_generado` (✅ generada este mes / ⏳ pendiente de generar).
Crear, editar o dar de baja una obligación es solo desde la app
(Administración, `CONTRACT.md` §6) — el bot no lo expone.

### 5.5 Callbacks y `callback_data`

Formato compacto (Telegram limita a 64 bytes):

| Prefijo | Significado | Contra qué se resuelve |
|---|---|---|
| `e:<idx>` | espacio elegido | `espacios_idx` del estado |
| `u:<idx>` | usuario elegido | `usuarios_idx` del estado |
| `c:<idx>` | categoría elegida | `categorias_idx` del estado |
| `ok` / `edit` / `cancel` | confirmar / corregir monto / cancelar | — |
| `sap:<id_solicitud>` | aprobar solicitud | `id_solicitud` completo (no hay estado de chat) |
| `srj:<id_solicitud>` | rechazar solicitud | ídem |

`<idx>` es un **índice**, no el id completo — el id real se resuelve contra
el array correspondiente, guardado en el estado de `CacheService` junto con
el borrador. `sap:`/`srj:` son la única excepción: como esos botones no
viven dentro de la conversación del chat que los toca, llevan el
`id_solicitud` completo en vez de un índice (igual entra sobrado en 64
bytes: `SOL_ab12cd34` son 12 caracteres).

Cada callback:

1. Responde `answerCallbackQuery` de inmediato (si no, el botón queda girando).
2. Si es `sap:`/`srj:`, se rutea directo (independiente del estado del chat).
   Si no, resuelve el índice contra el estado conversacional.
3. Avanza la máquina de estados y llama `editMessageText` sobre el mismo
   mensaje (no manda mensajes nuevos, salvo que el original ya no se pueda
   editar — ahí cae a `sendMessage`). Cuando el paso siguiente no trae un
   teclado nuevo (mensaje final, error, "operación expirada"), se edita con
   `reply_markup: {inline_keyboard: []}` explícito: `editMessageText` de
   Telegram **no** limpia los botones si se omite el parámetro, los deja
   como estaban. Omitirlo ahí es dejar un botón vivo que, tocado de nuevo,
   dispara la acción una segunda vez.

### 5.6 Máquina de estados

Clave en `CacheService`: `tg_estado_<chat_id>`, TTL 15 minutos. Nunca en
variables globales. (El último espacio usado por chat_id vive en una clave
aparte, `tg_ultimo_espacio_<chat_id>`, TTL 6h — el tope real de
`CacheService` en Apps Script — y es solo una comodidad de orden de botones,
nunca reemplaza la confirmación.)

```
(sin estado)
   |
   |-- /start (sin vincular) --> esperando_email
   |-- foto / /gasto / /ingreso --> esperando_espacio
   |-- /balance, /deudas --> esperando_espacio_accion
   |-- /solicitar --> esperando_espacio_solicitud
   v
esperando_email --(email válido)--> (vinculado, sin estado)
   |
esperando_espacio --(elige espacio)--> esperando_usuario
   |
esperando_usuario --(elige usuario)--> esperando_categoria
   |
esperando_categoria --(elige categoría)--> esperando_confirmacion
   |
esperando_confirmacion --(✅ Guardar)--> escribe en Sheets, borra estado
                        --(✏️ Corregir monto)--> esperando_monto_corregido
                        --(❌ Cancelar)--> borra estado
   |
esperando_monto_corregido --(monto válido, ya había espacio+usuario+categoría)--> esperando_confirmacion
                           --(monto válido, venía de foto sin monto)--> esperando_espacio

esperando_espacio_accion --(elige espacio)--> ejecuta balance/deudas, borra estado

esperando_espacio_solicitud --(elige espacio)--> esperando_categoria_solicitud
esperando_categoria_solicitud --(elige categoría)--> crearSolicitud(...), borra estado
```

`/cancelar` borra el estado desde cualquier punto de la máquina. La
respuesta a una solicitud (`sap:`/`srj:`) no pasa por esta máquina: se
resuelve siempre contra el `id_solicitud` del callback, sin importar en qué
estado esté el chat del propietario en ese momento.

---

## 6. TODO(contrato) pendientes de este módulo

- **Header del secreto del webhook**: ver §2 arriba — limitación de
  plataforma, no de implementación. Requiere decisión de arquitectura si se
  quiere una validación 100% estricta (proxy externo, o confirmar si algún
  Apps Script reciente sí expone `e.headers`).
- **Cuenta (`id_cuenta`) en transacciones del bot**: `CONTRACT.md` §5 no
  incluye un paso de selección de cuenta en el flujo del bot (solo espacio,
  usuario y categoría), pero `Transacciones` exige `id_cuenta`. Se usa la
  cuenta activa de menor `orden` **del espacio elegido** como default
  (`tgObtenerCuentaPorDefecto(idEspacio)` en `backend/40_telegram.js`). Si
  algún espacio maneja más de una cuenta relevante para gastos por bot, esto
  debería revisarse (¿agregar un paso de selección de cuenta, o dejarlo fijo?).
- **`getEspacios()` con fallback**: este módulo lee los espacios reales vía
  `getEspacios()` (`backend/11_espacios.js`, `CONTRACT.md` §3). Al momento de
  escribir el bot esa función (y `backend/23_solicitudes.js` /
  `backend/24_obligaciones.js` completos) todavía no existían en el repo —
  se desarrollaron en paralelo por otros agentes. `tgObtenerEspacios()` cae a
  un fallback fijo (`id_espacio` literal `ESP_FAMILIA`/`ESP_TELCOM`, contrato
  §0.3) si `getEspacios()` no existe o no devuelve filas. **Falta verificar**,
  una vez integrado todo el backend, que el `id_espacio` real que usa
  `91_setup.js` para crear los dos espacios coincide exactamente con esos dos
  literales — si el otro agente los generó con `generateId()` en vez de un id
  fijo, el fallback no calza con nada y hay que revisar `tgObtenerEspacios()`.
- **Payload de `crearSolicitud(p, u)` / `responderSolicitud(p, u)`**: los
  nombres de campo (`id_espacio`, `monto`, `motivo`, `id_categoria`,
  `id_solicitud`, `aprobar`) se tomaron de `CONTRACT.md` §2 (columnas de
  `SolicitudesDinero`) y §6 (firma del frontend
  `responderSolicitud(id, aprobar, motivo?)`), no de código leído — el
  archivo `backend/23_solicitudes.js` no existía todavía al escribir el bot.
  Si el agente que lo implemente usa otros nombres, hay que ajustar
  `tgFinalizarSolicitud` y `tgResponderSolicitudCallback` en
  `backend/40_telegram.js`.
- **Motivo de rechazo**: `CONTRACT.md` §4-bis dice que rechazar "pide un
  motivo opcional". El bot no lo pide (rechaza directo al tocar el botón):
  agregar ese paso significaría un estado más (`esperando_motivo_rechazo`)
  con opción de saltarlo, y no estaba en el alcance explícito de esta
  entrega. Si se quiere, es un agregado localizado en
  `tgResponderSolicitudCallback`.
