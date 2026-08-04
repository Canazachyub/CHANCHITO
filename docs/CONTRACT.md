# Chanchito v2 — Contrato compartido

Documento normativo. Todo agente que trabaje en este repo lo trata como **fuente de verdad**.
Si algo aquí contradice al `README.md`, gana este documento (aquí están resueltas las
ambigüedades que el README dejó abiertas). Si algo no está aquí ni en el README, **no inventar**:
dejarlo con un `TODO(contrato):` y reportarlo al terminar.

El código legacy de referencia está en `docs/Code.legacy.gs` (2460 líneas, Apps Script).
Se **reutiliza corrigiéndolo**, no se reescribe desde cero.

---

## 0. Decisiones cerradas (fuera de discusión)

1. **Autenticación: Google Sign-In**, no contraseñas propias. Se usa Google Identity Services
   (GIS) en el frontend; el backend valida el `id_token` contra
   `https://oauth2.googleapis.com/tokeninfo?id_token=...` vía `UrlFetchApp`.
   No se guarda ninguna contraseña ni hash en Sheets.
2. **Alta previa obligatoria.** El login solo tiene éxito si el email que devuelve Google ya
   existe en la hoja `Usuarios` con `activo = true`. Si no existe → `{ success: false, error: 'USUARIO_NO_AUTORIZADO' }`.
   El propietario da de alta los emails desde la pantalla Administración o desde el bot.
3. **Dos espacios compartidos, no personales**: `ESP_FAMILIA` y `ESP_TELCOM`. Ambos se crean al
   desplegar. Todos los miembros activos pertenecen a los dos; la app tiene un selector arriba
   para cambiar de uno a otro y el bot pregunta a cuál va cada registro.

   No son los espacios personales del sistema viejo (uno aislado por persona, que fue el error
   que el README § 14 manda no repetir): son dos libros compartidos por todo el grupo. La razón de
   separarlos es contable — Telcom factura, y mezclar el gasto de la empresa con el mercado de casa
   hace imposible cuadrar cualquiera de los dos. Balances, categorías, presupuestos, deudas y
   obligaciones son **por espacio** y nunca se suman entre sí.

   `ESPACIO_COMPARTIDO_ID` deja de existir como constante: todo endpoint recibe `id_espacio` y
   valida que el usuario sea miembro activo de ese espacio antes de leer o escribir.
4. **En el bot, el usuario se elige en cada registro.** Después de leer el voucher (o el texto),
   el bot muestra botones inline con los usuarios activos para elegir **de quién es el gasto**,
   y luego los botones de categoría. El `chat_id` sirve para saber quién *envía*, pero el gasto
   se atribuye al usuario **elegido**, que puede ser otro.
5. **Todo campo numérico se valida con `parseFloat` antes de escribir.** Si es `NaN` o negativo
   donde no corresponde, el endpoint devuelve error y **no escribe nada**. Esto es el fix a los `#NUM!`.
6. **Toda escritura pasa por `LockService.getScriptLock()`** con `tryLock(10000)` y un reintento.
7. **Todo request lleva token compartido** (`PropertiesService` → `SHARED_TOKEN`). Nunca hardcodeado.

---

## 1. Estructura del repo

```
/backend            Apps Script vía clasp. Archivos .js planos (clasp los sube como .gs).
/frontend           Vite + React + TypeScript → GitHub Pages.
/tests              Jest sobre la lógica pura de /backend/lib_*.js
/docs               Este contrato, guía de setup, y el código legacy de referencia.
```

### Regla de compatibilidad Apps Script ↔ Jest

La lógica pura (validación, cálculos, fechas, parsing) vive en `backend/lib_*.js`, **sin tocar
`SpreadsheetApp` ni ningún servicio de Google**, y termina con:

```js
if (typeof module !== 'undefined') { module.exports = { /* funciones */ }; }
```

En Apps Script `module` es `undefined`, así que la línea es inerte; en Jest permite `require()`.
Apps Script corre V8 pero **sin ESM**: nada de `import`/`export`, nada de `async/await` con
`fetch`. Usar `var`/`const`/`let`, funciones declaradas, y `UrlFetchApp` síncrono.

### Orden de carga de archivos backend

Apps Script comparte un único scope global entre archivos. Prefijo numérico para legibilidad:

```
backend/00_config.js        constantes, SHEETS, esquema de columnas, getProp()
backend/01_router.js        doGet / doPost / autenticación de token / ruteo
backend/02_util.js          jsonResponse, getSheet, generateId, fechas, findRow, getAllData, withLock
backend/03_auth.js          verificarIdToken, login, sesión, guardias de rol
backend/lib_validacion.js   PURO — validarMonto, validarRequeridos, validarFecha
backend/lib_calculos.js     PURO — balances, progreso de presupuesto, tendencia
backend/lib_sync.js         PURO — resolución de rev/conflicto
backend/10_usuarios.js      ... resto de dominios (espacios, cuentas, categorías, transacciones,
backend/11_espacios.js          evidencias, deudas, transferencias, presupuestos, recurrentes,
backend/...                     etiquetas, notificaciones, dashboard)
backend/30_sincronizar.js   endpoint sincronizar
backend/40_telegram.js      webhook, comandos, teclados inline, máquina de estados
backend/41_gemini.js        lectura de vouchers
backend/50_triggers.js      triggers diarios (deudas, recurrentes, presupuestos)
backend/90_migracion.js     migración de data existente
backend/91_setup.js         inicializarHojas, crearEspacioCompartido, categorías de sistema
```

### Firmas obligatorias de la lógica pura

Estas firmas son contrato: el agente de backend las implementa y el agente de tests escribe
contra ellas **sin cambiarlas**.

```js
// backend/lib_validacion.js
validarMonto(valor)              // → { valido: bool, valor: number, error?: 'MONTO_INVALIDO', detalle?: string }
                                 //   rechaza: NaN, null, '', '#NUM!', Infinity, negativos, > 1e9
                                 //   acepta: number, y string con coma o punto decimal ('45,90' → 45.9)
validarRequeridos(obj, campos)   // → { valido, error?: 'CAMPO_REQUERIDO', detalle?: 'falta: id_cuenta' }
validarFecha(valor)              // → { valido, valor: 'yyyy-MM-dd', error?: 'FECHA_INVALIDA' }
validarTipo(valor, permitidos)   // → { valido, valor, error?: 'CAMPO_REQUERIDO' }
esFilaCorrupta(fila, camposNum)  // → bool. true si algún campo numérico es '#NUM!', '#REF!', '#VALUE!' o NaN
sanearTexto(valor, maxLen)       // → string recortado, sin caracteres de control

// backend/lib_calculos.js
calcularBalance(transacciones, saldoInicial)     // ingreso suma, gasto resta → number
calcularResumenMensual(transacciones, mes, anio) // → { total_ingresos, total_gastos, saldo }
calcularProgresoPresupuesto(limite, gastado)     // → { gastado, limite, porcentaje: 0..100+, excedido: bool, restante }
agruparPorCategoria(transacciones, categorias)   // → array ordenado desc por total, con `proporcion` 0..1
calcularTendencia(transacciones, meses, hoy)     // → array de { mes, anio, ingresos, gastos } (hoy inyectable para test)
diasHastaVencimiento(fechaVencimiento, hoy)      // → entero, negativo si ya venció

// backend/lib_sync.js
resolverOperacion(op, filaActual)   // → { estado: 'aplicado'|'conflicto'|'rechazado', ... } según § 4.
                                    //   PURA: no toca Sheets, recibe la fila actual (o null si no existe)
siguienteRev(revActual)             // → entero
filtrarCambiosDesde(filas, desde)   // → filas con fecha_modificacion > desde (desde null → todas)
```

---

## 2. Modelo de datos (Google Sheets)

Se conservan las hojas del legacy. **Cambios respecto de `docs/Code.legacy.gs`** marcados con ⬅.

| Hoja | Columnas (en este orden exacto) |
|---|---|
| `Usuarios` | `id_usuario, email, nombre, foto_perfil, google_id, telegram_chat_id ⬅, rol_global ⬅, moneda_principal, fecha_registro, ultima_sesion, activo` |
| `Espacios` | `id_espacio, nombre, descripcion, id_propietario, icono, color, fecha_creacion, activo` |
| `MiembrosEspacio` | `id_miembro, id_espacio, id_usuario, rol, fecha_union, activo` |
| `Cuentas` | `id_cuenta, id_espacio, nombre, tipo, saldo_inicial, moneda, color, icono, incluir_total, orden, activo, fecha_creacion` |
| `Categorias` | `id_categoria, id_espacio, nombre, tipo, icono, color, es_sistema, grupo ⬅, orden, activo` |
| `Transacciones` | `id_transaccion, id_espacio, id_usuario, id_cuenta, id_categoria, tipo, monto, descripcion, fecha, hora, ubicacion, notas, rev ⬅, origen ⬅, eliminado ⬅, fecha_creacion, fecha_modificacion` |
| `Evidencias` | `id_evidencia, id_transaccion, tipo, url, nombre_archivo, tamano, fecha_subida` |
| `Deudas` | `id_deuda, id_espacio, id_usuario, tipo, persona, monto_original, monto_pendiente, descripcion, fecha_creacion, fecha_vencimiento, estado, recordatorio, notas, rev ⬅, origen ⬅, eliminado ⬅, fecha_modificacion ⬅` |
| `PagosDeuda` | `id_pago, id_deuda, monto, fecha, notas, id_transaccion` |
| `Transferencias` | `id_transferencia, id_espacio, id_usuario, cuenta_origen, cuenta_destino, monto, fecha, nota` |
| `Presupuestos` | `id_presupuesto, id_espacio, id_categoria, monto_limite, mes, anio, alerta_porcentaje, activo, rev ⬅, origen ⬅, eliminado ⬅, fecha_modificacion ⬅` |
| `OperacionesAplicadas` ⬅ | `op_id, id_registro, rev, resultado, fecha` |
| `SolicitudesDinero` ⬅ | `id_solicitud, id_espacio, id_solicitante, monto, motivo, id_categoria, estado, id_aprobador, fecha_solicitud, fecha_respuesta, id_transaccion, notas, eliminado, fecha_modificacion` |
| `ObligacionesMensuales` ⬅ | `id_obligacion, id_espacio, concepto, id_categoria, id_cuenta, monto_estimado, dia_vencimiento, ultimo_periodo_generado, activo, notas, fecha_creacion, eliminado, fecha_modificacion` |
| `GastosRecurrentes` | `id_gasto_recurrente, id_espacio, id_categoria, id_cuenta, descripcion, monto, frecuencia, dia_ejecucion, proximo_ejecucion, activo, fecha_creacion` |
| `Etiquetas` | `id_etiqueta, id_espacio, nombre, color` |
| `TransaccionEtiquetas` | `id, id_transaccion, id_etiqueta` |
| `Notificaciones` | `id_notificacion, id_usuario, tipo, titulo, mensaje, datos, canal ⬅, leida, fecha_creacion` |

Notas:
- `rol_global`: `propietario` | `miembro`. Exactamente un usuario con `propietario`.
- `origen`: `app` | `bot_texto` | `bot_foto` | `migracion`.
- `rev`: entero, empieza en `1`, sube en cada edición confirmada por el servidor.
- `eliminado`: booleano. **Los borrados son lógicos (`eliminado = true`), nunca `deleteRow`.**
  Razón: un borrado físico rompe la sincronización incremental (el cliente offline nunca se
  entera de que el registro desapareció). El legacy usa `deleteRow`; se corrige.
- `fecha_modificacion` se usa como marca para el sync incremental (`desde` en `sincronizar`).
- La hoja `TransferenciasInterUsuario` del legacy **se elimina**: existía solo para mover plata
  entre espacios personales aislados, y ya no existen.
- `grupo` en `Categorias`: agrupador visual para que una lista de 20+ categorías siga siendo
  legible. Valores en Telcom: `operativos`, `personal`, `activos`, `impuestos`, `ingresos`.
  En Familia queda vacío (`''`): con 11 categorías no hace falta agrupar.
- `SolicitudesDinero.estado`: `solicitada` | `aprobada` | `rechazada`. Al aprobar se crea la
  transacción de una vez y su id queda en `id_transaccion`. No hay estados de envío ni de
  recepción: fue decisión explícita del propietario, aprobar **es** entregar.
- `ObligacionesMensuales.ultimo_periodo_generado`: `'yyyy-MM'` del último mes en que ya se generó
  la deuda. Es lo que hace idempotente al trigger: si el mes en curso ya está ahí, no genera otra.
- `SolicitudesDinero` y `ObligacionesMensuales` **no son entidades sincronizables**: no llevan
  `rev` ni entran en el lote de `sincronizar`. Una solicitud necesita que el admin la vea y
  responda, y una obligación la administra el propietario; ambas cosas requieren conexión de
  todos modos. Se leen offline desde Dexie, pero crear o responder exige estar en línea.

---

## 3. Contrato de la API

Web App de Apps Script. `action` siempre viaja como **parámetro de URL** (en GET y en POST);
el body de POST es JSON. Toda respuesta es JSON con esta forma:

```jsonc
// éxito
{ "success": true, "data": { /* ... */ } }
// error
{ "success": false, "error": "CODIGO_ERROR", "detalle": "mensaje legible en español" }
```

**Códigos de error normativos:** `TOKEN_INVALIDO`, `USUARIO_NO_AUTORIZADO`, `SESION_INVALIDA`,
`MONTO_INVALIDO`, `CAMPO_REQUERIDO`, `FECHA_INVALIDA`, `NO_ENCONTRADO`, `SIN_PERMISO`,
`CONFLICTO_REV`, `LOCK_TIMEOUT`, `EMAIL_DUPLICADO`, `ESPACIO_INVALIDO`, `NO_ES_MIEMBRO`,
`SOLICITUD_YA_RESPONDIDA`, `ERROR_INTERNO`.

**Alcance por espacio:** toda acción que lea o escriba datos de dominio recibe `id_espacio` y
valida que exista y que el usuario de la sesión sea miembro activo (`NO_ES_MIEMBRO` si no).
Nunca se devuelve data de un espacio del que el usuario no es miembro, ni siquiera agregada.

### Autenticación de cada request

Todo request (GET y POST) incluye `token=<SHARED_TOKEN>`. Los requests de datos incluyen además
`sesion=<token_sesion>` devuelto por `login`.

Excepción única: `action=telegramWebhook`, que llama Telegram y no puede mandar nuestro token.
Su gate es `?secreto=<TELEGRAM_WEBHOOK_SECRET>` en la URL registrada con `setWebhook`.

> Apps Script **no expone los headers HTTP** en `doGet`/`doPost`, así que el header
> `X-Telegram-Bot-Api-Secret-Token` que manda Telegram es imposible de leer. El código intenta
> leerlo por si algún día lo exponen, pero la protección efectiva es el parámetro de URL.
> Va el secreto del webhook y **no** el `SHARED_TOKEN` porque esa URL queda almacenada en los
> servidores de Telegram: si se filtra, se rota un secreto de un solo uso en vez del token
> que abre toda la API.

### Sesión

`login` recibe `{ id_token }` de Google, lo valida, cruza el email contra `Usuarios`, y devuelve
`{ success: true, data: { usuario, token_sesion, expira } }`. El `token_sesion` es un UUID
guardado en `CacheService` del script con TTL de 6 horas, mapeado a `id_usuario`. Cada request de
datos lo revalida. Si expiró → `SESION_INVALIDA` y el frontend rehace el Google Sign-In.

### Acciones GET (lectura)

`login` (excepcionalmente POST), `getUsuario`, `getUsuarios`, `getEspacio`, `getMiembros`,
`getCuentas`, `getCuenta`, `getBalanceCuenta`, `getCategorias`, `getTransacciones`,
`getTransaccion`, `getEvidencias`, `getDeudas`, `getDeuda`, `getPagosDeuda`, `getTransferencias`,
`getPresupuestos`, `getProgresoPresupuesto`, `getGastosRecurrentes`, `getEtiquetas`,
`getNotificaciones`, `getDashboard`, `getResumenMensual`, `getTendencia`, `getTopCategorias`,
`getEspacios`, `getSolicitudes`, `getObligaciones`.

### Acciones POST (escritura)

`login`, `crearUsuario`, `actualizarUsuario`, `desactivarUsuario`, `actualizarEspacio`,
`crearCuenta`, `actualizarCuenta`, `eliminarCuenta`, `crearCategoria`, `actualizarCategoria`,
`eliminarCategoria`, `crearTransaccion`, `actualizarTransaccion`, `eliminarTransaccion`,
`subirEvidencia`, `eliminarEvidencia`, `crearDeuda`, `actualizarDeuda`, `eliminarDeuda`,
`registrarPagoDeuda`, `realizarTransferencia`, `crearPresupuesto`, `actualizarPresupuesto`,
`eliminarPresupuesto`, `crearGastoRecurrente`, `actualizarGastoRecurrente`,
`eliminarGastoRecurrente`, `ejecutarGastoRecurrente`, `crearEtiqueta`, `eliminarEtiqueta`,
`asignarEtiqueta`, `removerEtiqueta`, `marcarNotificacionLeida`, `marcarTodasLeidas`,
`sincronizar`, `telegramWebhook`, `logError`, `crearSolicitud`, `responderSolicitud`,
`crearObligacion`, `actualizarObligacion`, `eliminarObligacion`, `generarObligacionesDelMes`.

Nombres de función que implementa `backend/23_solicitudes.js` / `backend/24_obligaciones.js` y que
el router invoca (contrato entre agentes, no renombrar): `crearSolicitud(p, u)`,
`getSolicitudes(p)`, `responderSolicitud(p, u)`, `crearObligacion(p)`, `getObligaciones(p)`,
`actualizarObligacion(p)`, `eliminarObligacion(p)`, `generarObligacionesDelMes()`.

Los nombres y payloads de las acciones que ya existen en el legacy **se conservan**; solo cambian
la validación, el envoltorio `{success,data}`, `rev`/`origen` y el borrado lógico.

### Permisos

- `crearUsuario`, `desactivarUsuario`, `actualizarEspacio`, `ejecutarMigracion`: solo
  `rol_global = propietario`. `ejecutarMigracion` reescribe data histórica: **nunca** se expone
  sin token compartido ni sin sesión de propietario, por más que la llame un humano una sola vez.
- Todo lo demás: cualquier usuario activo del espacio.
- Un usuario **puede** editar transacciones de otro (es una billetera compartida y el registro
  por bot permite atribuir a terceros); queda registrado quién editó en `fecha_modificacion`.

---

## 4. Endpoint `sincronizar`

```jsonc
// POST ?action=sincronizar&token=...&sesion=...
{
  "id_espacio": "ESP_TELCOM",         // OBLIGATORIO: se sincroniza un espacio por vez
  "desde": "2026-08-01 10:00:00",     // null en la primera sincronización
  "operaciones": [
    {
      "op_id": "uuid-del-cliente",     // idempotencia: si ya se aplicó, se responde igual sin reescribir
      "tipo": "crear" | "editar" | "eliminar",
      "entidad": "transaccion" | "deuda" | "presupuesto",
      "id": "TRX_ab12cd34",            // en "crear", el id lo genera el cliente y el servidor lo respeta
      "rev_base": 3,                   // null en "crear"
      "datos": { /* campos de la entidad */ }
    }
  ]
}
```

Respuesta:

```jsonc
{
  "success": true,
  "data": {
    "resultados": [
      { "op_id": "...", "estado": "aplicado", "id": "TRX_...", "rev": 4 },
      { "op_id": "...", "estado": "conflicto", "id": "TRX_...",
        "version_servidor": { /* fila completa actual */ },
        "version_cliente":  { /* lo que mandó el cliente */ } },
      { "op_id": "...", "estado": "rechazado", "error": "MONTO_INVALIDO", "detalle": "..." }
    ],
    "cambios": {                        // todo lo que cambió en el servidor desde "desde"
      "transacciones": [ /* filas con rev y eliminado */ ],
      "deudas": [], "presupuestos": [], "categorias": [], "cuentas": [], "usuarios": []
    },
    "servidor_ts": "2026-08-02 14:35:00" // el cliente lo guarda como próximo "desde"
  }
}
```

Reglas:
- **Un lote por espacio.** El servidor acota `cambios` al `id_espacio` recibido, rechaza con
  `NO_ES_MIEMBRO` toda operación sobre un registro de otro espacio, y en las creaciones fuerza
  el `id_espacio` del lote ignorando el que mande el cliente.
- El cliente guarda un `servidor_ts` **por espacio**, no uno global: con un marcador compartido,
  sincronizar Familia lo adelantaría y Telcom se perdería todo lo ocurrido en el medio.
- Las operaciones se aplican **en orden**, todas dentro de un único `LockService`.
- `rev_base !== rev_actual` → `conflicto`, **no se sobrescribe**.
- Una operación rechazada **no aborta** el lote; las siguientes se siguen aplicando.

### Idempotencia de `op_id` — persistente, no en cache

`CacheService` de Apps Script tiene un tope real de **6 horas**, y un cliente puede pasar días
sin conexión. Si el `op_id` se olvida antes de que el cliente reintente, el lote se aplica dos
veces y el gasto se duplica. Por eso la idempotencia vive en la hoja **`OperacionesAplicadas`**:

| Columna | |
|---|---|
| `op_id` | UUID generado por el cliente |
| `id_registro` | id de la entidad afectada |
| `rev` | rev resultante |
| `resultado` | JSON del resultado devuelto la primera vez |
| `fecha` | para la purga |

Antes de aplicar una operación se busca su `op_id`; si está, se devuelve `resultado` tal cual sin
reescribir nada. `CacheService` se mantiene solo como caché de lectura rápida delante de la hoja.
Un trigger diario purga las filas de más de 30 días.

### Entidad `pago_deuda` en el lote

Registrar un pago no es editar la deuda: además de bajar `monto_pendiente` y quizá cerrar el
`estado`, inserta una fila en `PagosDeuda`. Modelarlo como una edición pierde el historial de
pagos hecho sin conexión. Por eso el lote acepta:

```jsonc
{ "op_id": "...", "tipo": "crear", "entidad": "pago_deuda",
  "id": "PAG_ab12cd34",          // lo genera el cliente
  "rev_base": 5,                  // rev de la DEUDA al momento de registrar el pago
  "datos": { "id_deuda": "DDA_...", "monto": 50.00, "fecha": "2026-08-02", "notas": "" } }
```

El servidor, dentro del mismo lock: valida el monto contra `monto_pendiente`, inserta en
`PagosDeuda`, actualiza la deuda (`monto_pendiente`, `estado`, `rev + 1`, `fecha_modificacion`) y
devuelve la deuda actualizada. Si `rev_base` no coincide con el `rev` de la deuda → `conflicto`
normal, porque significa que alguien más la tocó entre medio.

La deuda actualizada viaja en `version_servidor`, el mismo campo que ya usa `conflicto` para
"fila completa actual". El resultado queda así:

```jsonc
{ "op_id": "...", "estado": "aplicado", "id": "PAG_ab12cd34",
  "id_deuda": "DDA_...", "rev": 6,
  "version_servidor": { /* fila completa de la deuda ya actualizada */ } }
```

`rev` es el de la **deuda**, no el del pago: `PagosDeuda` es un libro de solo-inserción y sus
filas no se editan, así que no llevan `rev` propio.

---

## 4-bis. Solicitudes de dinero

Caso real: alguien está en campo, necesita plata para un trámite o unos materiales, y hoy eso se
resuelve por WhatsApp sin quedar registrado en ningún lado.

Flujo, deliberadamente corto:

1. Cualquier miembro crea una solicitud: monto, motivo, categoría sugerida y espacio.
   Estado inicial `solicitada`. Desde la app o con `/solicitar` en el bot.
2. Al propietario le llega **notificación interna y mensaje de Telegram** con los datos y dos
   botones inline: `[✅ Aprobar] [❌ Rechazar]`.
3. **Aprobar** crea de una vez la transacción de gasto en el espacio de la solicitud
   (`origen = 'app'` o `'bot_texto'` según de dónde vino la respuesta), guarda `id_transaccion`,
   `id_aprobador` y `fecha_respuesta`, y pasa a `aprobada`. **Rechazar** solo cambia el estado y
   pide un motivo opcional. En ambos casos se le avisa al solicitante por su canal.
4. Una solicitud ya respondida no se puede volver a responder: el segundo intento devuelve
   `SOLICITUD_YA_RESPONDIDA`. Sin esto, dos toques al botón de Telegram crean dos gastos.

Acciones: `crearSolicitud`, `getSolicitudes` (filtrable por estado y espacio), `responderSolicitud`
(solo propietario). Todas requieren conexión.

## 4-ter. Obligaciones mensuales

Las cuentas previsibles de la empresa (planilla, EsSalud, CTS, alquiler, seguros) y de la casa.
Se definen una vez y el sistema las materializa cada mes.

- El propietario define: concepto, categoría, cuenta, monto estimado, día de vencimiento, espacio.
- Un **trigger diario** revisa las obligaciones activas: si el mes en curso no está en
  `ultimo_periodo_generado`, crea la `Deuda` correspondiente (`tipo = 'debo'`, `persona` = el
  concepto, `monto_original` y `monto_pendiente` = `monto_estimado`, `fecha_vencimiento` = el día
  de este mes, `origen = 'app'`) y actualiza `ultimo_periodo_generado`. Idempotente por diseño:
  correr el trigger diez veces el mismo día genera una sola deuda.
- Si `dia_vencimiento` es 29, 30 o 31 y el mes no lo tiene, se usa el último día del mes. Febrero
  existe y rompe las cosas.
- A partir de ahí es una deuda normal: avisa por Telegram tres días antes, y al registrar el pago
  (parcial o total) se crea el gasto con la categoría de la obligación.
- El monto de un mes puntual se edita sobre la deuda generada, sin tocar la plantilla. Dar de baja
  la obligación (`activo = false`) deja intactas las deudas ya generadas.

Acciones: `crearObligacion`, `getObligaciones`, `actualizarObligacion`, `eliminarObligacion`
(baja lógica), `generarObligacionesDelMes` (la que llama el trigger, también invocable a mano).
Las tres de escritura son solo para el propietario.

## 5. Bot de Telegram

Máquina de estados por `chat_id`, guardada en `CacheService` con TTL de 15 minutos
(clave `tg_estado_<chat_id>`). Nunca guardar estado en variables globales: Apps Script no las
conserva entre invocaciones.

### Comandos

| Comando | Quién | Qué hace |
|---|---|---|
| `/start` | cualquiera | Si el `chat_id` ya está vinculado, saluda. Si no, pide el email; si el email existe en `Usuarios` y está activo, guarda el `telegram_chat_id` y confirma. Si no existe: "Pídele acceso al administrador." |
| `/gasto <monto> <descripción>` | vinculado | Registro por texto. |
| `/ingreso <monto> <descripción>` | vinculado | Igual pero tipo ingreso. |
| `/balance` | vinculado | Resumen del mes en curso, sin abrir la app. |
| `/deudas` | vinculado | Deudas pendientes con vencimiento. |
| `/agregar <nombre> <email>` | solo propietario | Alta de usuario. |
| `/quitar <email>` | solo propietario | Baja lógica (`activo = false`). |
| `/cancelar` | cualquiera | Limpia el estado de la conversación. |
| `/solicitar <monto> <motivo>` | vinculado | Crea una solicitud de dinero (§ 4-bis). Pregunta el espacio y la categoría, avisa al propietario con botones de aprobar/rechazar. |
| `/solicitudes` | vinculado | Miembro: sus solicitudes y su estado. Propietario: las pendientes de responder. |
| `/obligaciones` | vinculado | Obligaciones del mes y si ya se generaron (§ 4-ter). |

**Paso de espacio, antes que el de usuario.** Todo registro por bot pregunta primero
`¿Familia o Telcom?` con dos botones, porque la categoría y la cuenta dependen del espacio.
El orden completo del flujo por foto pasa a ser: leer voucher → **espacio** → usuario →
categoría → confirmar. `/balance` y `/deudas` también preguntan el espacio.

Excepción por comodidad: se recuerda el último espacio usado por `chat_id` (en el mismo cache de
estado) y se muestra primero, pero **siempre** se pide confirmarlo. Asumirlo en silencio es cómo
un gasto de la empresa termina en el libro de la casa.

### Flujo de registro por foto (el caso principal)

1. Llega un mensaje con `photo`. Se toma el `file_id` de mayor resolución.
2. `getFile` → descarga vía `https://api.telegram.org/file/bot<TOKEN>/<file_path>` con `UrlFetchApp`.
3. Se manda el blob en base64 a Gemini (`gemini-2.0-flash`) pidiendo **JSON estricto**:
   ```json
   { "monto": 45.90, "comercio": "Metro", "fecha": "2026-08-02",
     "categoria_sugerida": "Comida", "confianza": 0.92 }
   ```
   `categoria_sugerida` debe salir de la **lista cerrada** de categorías de gasto de la sección 9
   del README. Si Gemini devuelve algo fuera de la lista → `Otros gastos`.
4. El bot responde con el resumen leído y **botones inline de usuarios activos**:
   `¿De quién es este gasto?` → `[Ana] [Luis] [Carla] ...`
5. Elegido el usuario → botones de categoría (la sugerida marcada con ✓ al inicio).
6. Elegida la categoría → mensaje de confirmación con `[✅ Guardar] [✏️ Corregir monto] [❌ Cancelar]`.
7. Al guardar: se crea la transacción con `origen = 'bot_foto'`, `id_usuario` = el elegido,
   se sube la foto a Drive (`DRIVE_FOLDER_ID`) y se registra en `Evidencias`.
8. **Nada se escribe en Sheets antes del paso 7.** Todo lo intermedio vive en el estado del cache.

El flujo por texto es el mismo desde el paso 4 (elegir usuario → categoría → confirmar).

### Callbacks

`callback_data` con formato compacto (Telegram limita a 64 bytes):
`u:<id_usuario_corto>`, `c:<id_categoria_corto>`, `ok`, `edit`, `cancel`.

Siempre responder `answerCallbackQuery` para que el botón deje de girar, y `editMessageText`
para avanzar el mismo mensaje en vez de llenar el chat de mensajes nuevos.

### Recordatorio de deudas

Trigger diario: deudas con `estado = pendiente` y `fecha_vencimiento` a 3 días o menos →
crea `Notificacion` con `canal = 'telegram'` y manda `sendMessage` al `telegram_chat_id` del
`id_usuario` de la deuda. Si el usuario no tiene `chat_id`, solo notificación interna.

---

## 6. Frontend

### Propiedad de archivos (para no pisarse entre agentes)

| Ruta | Dueño |
|---|---|
| `frontend/src/design/**`, `frontend/src/components/**`, `frontend/src/screens/{Resumen,Gastos,Deudas,Admin,Login}.tsx` | Agente de UI |
| `frontend/src/offline/**`, `frontend/src/data/api.ts`, `frontend/src/screens/Conflictos.tsx`, `frontend/public/sw*`, `vite.config.ts` | Agente de offline |
| `frontend/src/data/types.ts`, `frontend/src/App.tsx`, `frontend/src/main.tsx`, `package.json`, `tsconfig*.json`, `index.html` | Ya scaffoldeados; **no reescribir**, solo extender si es imprescindible |

### Capa de datos

La UI **nunca** llama a la red directamente. Consume `frontend/src/data/api.ts`, que expone
funciones que leen de Dexie y encolan mutaciones. La UI no sabe si hay conexión.
Los tipos compartidos están en `frontend/src/data/types.ts`.

### Interfaz entre los dos agentes de frontend

`frontend/src/App.tsx` ya está escrito y **no se modifica**. Fija estas firmas:

```ts
// Dueño: agente de OFFLINE — frontend/src/data/api.ts
export function getSesion(): Promise<Sesion | null>;
export function onSesionChange(cb: (s: Sesion | null) => void): () => void;  // devuelve unsubscribe
export function iniciarSesion(idTokenGoogle: string): Promise<Sesion>;
export function cerrarSesion(): Promise<void>;

export function useTransacciones(filtro?: FiltroGastos): Transaccion[] | undefined;
export function useResumenMensual(mes: number, anio: number): ResumenMensual | undefined;
export function useDeudas(): Deuda[] | undefined;
export function useCategorias(tipo?: TipoMovimiento): Categoria[] | undefined;
export function useCuentas(): Cuenta[] | undefined;
export function useUsuarios(): Usuario[] | undefined;
export function useEstadoSync(): { pendientes: number; sincronizando: boolean; enLinea: boolean };

// Espacio activo (§ 0.3). Todos los hooks de datos de arriba se filtran por él implícitamente.
export function useEspacioActivo(): { id_espacio: string; nombre: string; icono: string } | undefined;
export function useEspacios(): Espacio[] | undefined;
export function cambiarEspacio(idEspacio: string): Promise<void>;

// Solicitudes de dinero (§ 4-bis) y obligaciones mensuales (§ 4-ter). Requieren conexión.
export function useSolicitudes(estado?: EstadoSolicitud): SolicitudDinero[] | undefined;
export function crearSolicitud(s: NuevaSolicitud): Promise<void>;
export function responderSolicitud(id: string, aprobar: boolean, motivo?: string): Promise<void>;
export function useObligaciones(): ObligacionMensual[] | undefined;
export function crearObligacion(o: NuevaObligacion): Promise<void>;
export function actualizarObligacion(id: string, cambios: Partial<ObligacionMensual>): Promise<void>;
export function eliminarObligacion(id: string): Promise<void>;
// Sin ancla termina en el mes actual; con ancla, en el mes que muestre el selector de Resumen.
export function useTendencia(meses: number, mesHasta?: number, anioHasta?: number): Array<{ mes: number; anio: number; ingresos: number; gastos: number }> | undefined;

export function crearTransaccion(t: NuevaTransaccion): Promise<void>;   // optimista: escribe en Dexie y encola
export function editarTransaccion(id: string, cambios: Partial<Transaccion>): Promise<void>;
export function eliminarTransaccion(id: string): Promise<void>;
export function crearDeuda(d: NuevaDeuda): Promise<void>;
export function registrarPagoDeuda(idDeuda: string, monto: number): Promise<void>;
export function crearUsuario(u: { nombre: string; email: string }): Promise<void>;
export function desactivarUsuario(idUsuario: string): Promise<void>;
export function sincronizarAhora(): Promise<void>;

// Dueño: agente de OFFLINE — frontend/src/screens/Conflictos.tsx
export default function Conflictos(): JSX.Element | null;  // null si no hay conflictos pendientes

// Dueño: agente de UI
// screens/Login.tsx     → default ({ onEntrar }: { onEntrar: (s: Sesion) => void })
// screens/Resumen.tsx   → default ({ sesion }: { sesion: Sesion })
// screens/Gastos.tsx    → default ({ sesion }: { sesion: Sesion })
// screens/Deudas.tsx    → default ({ sesion }: { sesion: Sesion })
// screens/Admin.tsx     → default ({ sesion }: { sesion: Sesion })
// components/TabBar.tsx → default ({ activo, onCambiar, mostrarAdmin })
```

Los hooks devuelven `undefined` mientras cargan (convención de `dexie-react-hooks`); la UI
muestra su estado de carga con eso. `frontend/src/design/tokens.css` lo crea el agente de UI y
lo importa `main.tsx`; debe existir sí o sí o el build falla.

### Sistema de diseño (sección 8 del README, obligatorio)

```css
--bg: #F5F5F7;  --text: #1D1D1F;  --accent: #0A84FF;
--expense: #FF453A;  --income: #30D158;
```

Derivados permitidos (y solo estos): `--surface: #FFFFFF`, `--text-secondary: #86868B`,
`--separator: rgba(60,60,67,0.18)`, más variantes con opacidad de los tokens de arriba.
Modo oscuro vía `prefers-color-scheme` con los mismos roles.

Tipografía `system-ui, -apple-system, 'Segoe UI', Inter, sans-serif`.
Montos siempre con `font-variant-numeric: tabular-nums`.

Layout: tarjetas apiladas; **una sola** tarjeta hero (saldo del mes) con vidrio esmerilado
(`backdrop-filter: blur(20px)`); anillos de progreso por categoría como elemento firma
(SVG propio, no librería); tab bar inferior fija de tres secciones
(Resumen · Gastos · Deudas), más Administración accesible solo para el propietario.

**Selector de espacio**: control segmentado `Familia | Telcom` fijo arriba, visible en las tres
pantallas. Al cambiar, todo lo de abajo cambia con él. Tiene que ser imposible mirar la pantalla y
no saber en qué libro estás: si el saldo de la empresa se confunde con el de la casa, el sistema
falló en su único trabajo. El espacio activo se guarda en Dexie y sobrevive al cierre de la app.

**Solicitudes de dinero**: van dentro de la pestaña Deudas como una segunda sección (son plata
que se mueve entre personas del grupo, no un cuarto ítem de navegación). El propietario ve arriba
las pendientes de responder con los botones de aprobar y rechazar; el resto ve las suyas con su
estado. **Obligaciones mensuales**: se administran desde Administración, con su lista, el monto
estimado, el día de vencimiento y si la del mes en curso ya se generó.
**Prohibido:** librerías de componentes (Material, Bootstrap, Semantic, shadcn), menú
hamburguesa, sidebar, y cualquier color fuera de la lista de arriba.

Base de despliegue: GitHub Pages en subruta → `base: '/CHANCHITO/'` en `vite.config.ts`
y router en modo hash.

---

## 6-bis. Categorías predeterminadas por espacio

Todas con `es_sistema = true`, creadas al desplegar, no editables ni eliminables. El propietario
puede agregar categorías propias en cualquiera de los dos espacios.

### `ESP_FAMILIA` (README § 9, sin cambios) — `grupo = ''`

Gasto: Comida, Transporte, Gastos fijos, Servicios (internet, luz, agua), Salud, Educación,
Entretenimiento, Otros gastos.
Ingreso: Sueldo, Ingresos extra, Otros ingresos.

### `ESP_TELCOM`

| `grupo` | Categorías de gasto |
|---|---|
| `operativos` | Notaría y trámites · Servicios técnicos · Viáticos · Pasajes y transporte · Materiales de trabajo · Combustible · Alquiler de oficina · Servicios de oficina |
| `personal` | Sueldos y honorarios · Facturas de trabajadores · Adelantos · CTS · EsSalud · Seguros · Gratificaciones |
| `activos` | Muebles y enseres · Equipos de cómputo · Útiles de oficina |
| `impuestos` | Impuestos y SUNAT |
| — | Otros gastos operativos |

Ingreso (`grupo = 'ingresos'`): Servicios facturados · Otros ingresos.

Notas de modelado:
- **Adelantos** es gasto, no préstamo: sale plata hoy. Si además se quiere seguir el descuento
  posterior, se registra como `Deuda` de tipo `me_deben` contra esa persona.
- **Facturas de trabajadores** y **Sueldos y honorarios** van separadas a propósito: recibo por
  honorarios y planilla tienen tratamiento tributario distinto y conviene poder sumarlas aparte.
- **Activos** (muebles, PC) se registran como gasto igual que todo lo demás. Este sistema es una
  billetera, no contabilidad formal: no hay depreciación ni activo fijo, y meterla sería
  convertirlo en otra cosa. Si el contador la necesita, sale del reporte por grupo.

## 7. Propiedades del script (`PropertiesService`)

Ninguna de estas va al código fuente. Se cargan a mano una sola vez.

| Clave | Uso |
|---|---|
| `SHARED_TOKEN` | Token compartido que valida todo request |
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto del header del webhook |
| `GEMINI_API_KEY` | API key de Gemini |
| `SENTRY_DSN_BACKEND` | Webhook de Sentry para errores del backend |
| `SPREADSHEET_ID` | `TU_SPREADSHEET_ID` |
| `DRIVE_FOLDER_ID` | `TU_DRIVE_FOLDER_ID` |
| `GOOGLE_CLIENT_ID` | OAuth Client ID para validar el `id_token` |

`00_config.js` las lee con un helper `getProp(clave)` que cachea y lanza error claro si falta.

---

## 8. Reglas de calidad

- Nunca escribir en la hoja sin validar antes. Nunca escritura parcial.
- Nunca `deleteRow` en entidades sincronizables: borrado lógico.
- Toda escritura dentro de `withLock(fn)`.
- Todo `catch` del backend registra en `Notificaciones` con `tipo = 'sistema'` y reporta a Sentry.
- La lógica pura va en `lib_*.js` y **tiene** test en `/tests`.
- Código y mensajes de usuario en español; nombres de campo en `snake_case` como el legacy.
- Comentarios solo donde el "por qué" no sea obvio. No documentar lo que el código ya dice.
