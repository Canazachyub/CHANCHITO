# Chanchito v2

Billetera compartida con **dos libros separados**: `ESP_FAMILIA` (gastos de la casa) y
`ESP_TELCOM` (gastos de la empresa Ingeniería Telcom). Se registra desde un bot de Telegram
(texto o foto de voucher leída con Gemini) y desde una PWA instalable que funciona sin conexión.

Backend en Google Apps Script + Sheets, frontend en React + TypeScript + Vite.

---

## Estado al 2 de agosto de 2026

### Construido y verificado

| Área | Estado |
|---|---|
| Backend (32 archivos, ~7.000 líneas) | Completo. Sin colisiones de scope global, sin sintaxis incompatible con Apps Script. |
| Frontend PWA (41 archivos) | Completo. `tsc -b` y `npm run build` pasan limpios, service worker generado. |
| Tests | **177 pasando**, 9 suites. `npm test` |
| Backend desplegado | Sí. Responde `TOKEN_INVALIDO` sin token y `SESION_INVALIDA` sin sesión. |
| Hojas de Sheets | Creadas y migradas. 18 hojas, columnas nuevas agregadas al final sin perder data. |
| Usuario propietario | Creado (`TelcomAdmin` / `energysupervision13@gmail.com`). |

### Pendiente

1. **Login de Google bloqueado por propagación.** La consola del navegador devuelve
   `[GSI_LOGGER]: The given origin is not allowed for the given client ID`. El Client ID y el
   origen `http://localhost:5173` están bien configurados; Google avisa que el cambio tarda
   "de 5 minutos a algunas horas". A los 30 min seguía en 403.
   **Primer paso de la próxima sesión:** verificar en Google Auth Platform → Clientes →
   `Chanchito PWA` que el origen esté efectivamente guardado. Si está, esperar; si no, agregarlo.

2. **Bot de Telegram sin arrancar.** Falta crear el bot en @BotFather, cargar
   `TELEGRAM_BOT_TOKEN` y `GEMINI_API_KEY` en las propiedades del script, y registrar el webhook
   (comando exacto en `docs/BOT.md` § 2). **El bot no depende del login de Google** — se
   autentica por `chat_id` contra la hoja `Usuarios`, así que se puede probar aunque el OAuth
   siga propagando.

3. **Triggers sin activar.** Ejecutar `configurarTriggersChanchito()` desde el editor de Apps
   Script. Activa cinco triggers diarios: recordatorio de deudas, generación de obligaciones
   mensuales, gastos recurrentes, presupuestos y purga de `OperacionesAplicadas`.

4. **Migración de data histórica sin correr.** `ejecutarMigracion` requiere sesión de
   propietario, así que depende del login. Manda la data a `ESP_TELCOM` por defecto (el archivo
   original es `APPTELCOMAHORRO.xlsx`, contabilidad de la empresa). **Correr primero en dry-run
   y revisar los descartes** antes del modo real.

5. **Usuarios legacy sin rol.** La hoja `Usuarios` tiene cuatro filas previas
   (`yubertc1@`, `zaelatmosfera@`, `testclaude@test.com`, `canazach12@`) sin `rol_global`.
   Hay que decidir cuáles se activan como miembros y cuáles se descartan —
   `testclaude@test.com` parece de prueba.

6. **Frontend no publicado.** Solo corre en local (`npm run dev` en `/frontend`). Falta activar
   GitHub Pages y agregar `https://<usuario>.github.io` a los orígenes autorizados del Client ID.

### Decisiones pendientes de confirmar con el usuario

- **Cuenta por defecto en el formulario de gasto**: hoy arranca vacío. Se puede preseleccionar la
  de menor `orden`, como ya hace el bot.
- **Solicitudes de dinero**: hoy viven dentro de la pestaña Deudas como segunda sección. Se puede
  mover a su propia pestaña si se prefiere.

---

## Cómo continuar

```bash
npm test                       # 177 tests, lógica pura del backend
npm run bundle                 # junta backend/*.js en build/Code.gs para pegar en Apps Script
cd frontend && npm run dev     # http://localhost:5173/CHANCHITO/
```

**Modo demo sin backend**: poner `VITE_DEMO=true` en `frontend/.env.local`. Siembra los dos
espacios con data de ejemplo, solicitudes, obligaciones y una sesión falsa, para revisar la
interfaz sin depender de OAuth. `VITE_DEMO=false` vuelve al login real.

### Despliegue del backend

Dos caminos. `clasp push` sube los 32 archivos y los mantiene sincronizados (mejor si se va a
tocar el código seguido). `npm run bundle` genera un único `build/Code.gs` de ~7.200 líneas para
pegar de una sola vez en el editor web (más rápido para arrancar).

**Después de pegar código nuevo hay que crear una versión nueva de la implementación**
(*Implementar* → *Administrar implementaciones* → ✏️ → *Versión: Nueva versión*). Si no, la URL
`/exec` sigue sirviendo el código viejo. Editar la implementación existente conserva la URL;
crear una nueva la cambia y obliga a reconfigurar el webhook y el frontend.

### Credenciales

**Ninguna vive en este repo.** El backend las lee de `PropertiesService` (⚙️ *Configuración del
proyecto* → *Propiedades del script*) y el frontend de `frontend/.env.local`, que está en
`.gitignore`. La lista completa está en `docs/CONTRACT.md` § 7 y `docs/SETUP.md`.

Cargadas: `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`, `SHARED_TOKEN`, `GOOGLE_CLIENT_ID`,
`PROPIETARIO_EMAIL`, `PROPIETARIO_NOMBRE`.
Faltan: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `SENTRY_DSN_BACKEND`.

> El `SHARED_TOKEN` actual y la URL del Web App circularon por el chat durante el setup.
> Conviene rotarlos antes de cargar data real de sueldos y facturas: generar uno nuevo, cambiarlo
> en las propiedades del script y en `frontend/.env.local`.

---

## Mapa del repo

```
docs/CONTRACT.md      Documento NORMATIVO. Manda sobre este README donde difieran.
docs/SETUP.md         Puesta en marcha de cero, paso a paso.
docs/BOT.md           Bot de Telegram: @BotFather, webhook, flujos de conversación.
docs/AUDITORIA.md     Checklist de calidad verificable (README § 11 convertido en procedimientos).
docs/Code.legacy.gs   Backend v1 original (2.460 líneas), solo referencia.

backend/              32 archivos .js que clasp sube como .gs. Ver el orden en CONTRACT.md § 1.
frontend/             Vite + React + TS. La UI nunca llama a la red: todo pasa por src/data/api.ts.
tests/                Jest sobre la lógica pura (backend/lib_*.js). No requiere Sheets.
scripts/bundle.js     Genera build/Code.gs.
```

---

## Trampas ya pisadas (no volver a caer)

Cinco fallos reales encontrados durante la construcción. Están arreglados; se documentan porque
son el tipo de cosa que vuelve si alguien "simplifica" el código sin conocer la razón.

1. **Escritura posicional en las hojas.** 22 sitios usaban `appendRow([...])` asumiendo el orden
   de `ESQUEMA_COLUMNAS`, pero `_asegurarColumnas` agrega las columnas nuevas **al final** de una
   hoja migrada. Los valores caían en la columna equivocada y corrompían la fila. Ahora existe
   `anexarFila(sheet, datos)` (`02_util.js`), que arma la fila según los encabezados **reales**.
   Es la única función del backend autorizada a llamar `appendRow`. Cubierto por
   `tests/lib_filas.test.js`.

2. **`id_espacio` faltante en `sincronizar`.** El backend lo exigía y el frontend no lo mandaba:
   la app funcionaba perfecta en local y no subía un solo registro. Además, el marcador
   `servidor_ts` era único: con dos espacios, sincronizar Familia lo adelantaba y Telcom perdía
   sus cambios para siempre. Ahora es **un lote y un marcador por espacio**.

3. **Idempotencia en `CacheService`.** Tope real de 6 h. Un cliente que estuvo días sin conexión
   y reintentaba el lote duplicaba los gastos. Ahora vive en la hoja `OperacionesAplicadas`.

4. **Pago de deuda modelado como edición.** Perdía la fila de `PagosDeuda`, o sea el historial de
   pagos hechos sin conexión. Ahora es la entidad `pago_deuda` del lote (CONTRACT § 4).

5. **`callback_data` divergente entre módulos.** Los botones de aprobar/rechazar solicitudes se
   generaban con un prefijo y se ruteaban con otro: no hacían nada. El teclado tiene un solo
   dueño (`tgTecladoSolicitud` en `42_telegram_teclados.js`).

Y dos restricciones de plataforma que no son bugs sino límites:

- **Apps Script no expone headers HTTP.** El `X-Telegram-Bot-Api-Secret-Token` que manda Telegram
  es imposible de leer. El webhook se protege con `?secreto=` en la URL, que por eso **es una
  credencial** y no debe compartirse.
- **Un único scope global** entre todos los archivos del backend. No puede haber dos funciones
  con el mismo nombre. Verificar con:
  `grep -h "^function " backend/*.js | sed 's/(.*//' | sort | uniq -d` (debe salir vacío).

---

## Especificación original

Lo que sigue es el documento con el que arrancó el proyecto. Se conserva como registro de la
intención inicial. **Donde contradiga a `docs/CONTRACT.md`, manda el contrato**, que recoge las
decisiones tomadas después: dos espacios en vez de uno, login con Google en vez de contraseñas,
selección de usuario en cada registro del bot, solicitudes de dinero y obligaciones mensuales.


Documento de referencia único para Claude Code. Rol esperado: actuar como arquitecto y desarrollador full-stack del proyecto, tomando cada decisión técnica ya cerrada abajo como restricción de diseño, no como sugerencia. Donde algo no esté especificado, preguntar antes de asumir.

## 1. Contexto del proyecto

Billetera compartida para un grupo cerrado de aproximadamente 10 personas (familia o convivientes). Cada quien registra ingresos y gastos, puede tener deudas con recordatorio, y revisa su balance desde el celular. Se registra por dos canales: un bot de Telegram (texto o foto de voucher) y una PWA instalable que funciona sin conexión.

Existe una versión previa, Chanchito, en Google Apps Script + Sheets, con el modelo de datos ya resuelto pero sin capa offline, sin bot y con bugs de validación. Se reutiliza su backend corrigiéndolo, no se reconstruye desde cero.

## 2. Stack por área funcional

| Área | Tecnología | Por qué |
|---|---|---|
| Backend / API | Google Apps Script (V8 runtime), `ContentService`, `LockService`, `UrlFetchApp` | Serverless gratuito, siempre activo, ya es la base de Chanchito |
| Base de datos | Google Sheets vía `SpreadsheetApp` | Sin costo, ya contiene la data histórica a migrar |
| Bot | Telegram Bot API, webhook directo a Apps Script (`telegramWebhook`) | No requiere servidor propio, un solo backend para todo |
| IA de lectura de vouchers | Gemini API (`gemini-2.0-flash` o superior, con soporte de visión), llamado vía `UrlFetchApp` | Ya decidido, buena relación costo/calidad para OCR estructurado |
| Frontend | React + TypeScript, compilado con Vite, salida estática a GitHub Pages | Consistente con el resto de tu stack, sin necesidad de servidor, Vite genera build estático puro compatible con GH Pages |
| Estilos | CSS puro con variables (design tokens) o Tailwind, sin librería de componentes (nada de Semantic UI, Material o Bootstrap) | El diseño Apple necesita control fino de espaciado y tipografía que una librería de componentes genéricos no da bien |
| Gráficas | Recharts o Chart.js | Para los anillos de categoría y la tendencia mensual |
| Almacenamiento local / offline | Dexie.js sobre IndexedDB | Persistencia local confiable, API más simple que IndexedDB directo |
| PWA / offline shell | Workbox (service worker) | Estándar de facto para cachear el shell de la app |
| Archivos adjuntos | Google Drive API vía Apps Script (`DriveApp`) | Ya funciona así en Chanchito, se conserva |
| Monitoreo de errores | Sentry (capa gratuita), tanto en el frontend como reportando desde Apps Script vía webhook | Rescatado directo de money-tracker, que ya usa `@sentry/browser`; con 10 usuarios reales vas a necesitar saber cuándo algo falla sin que te escriban para avisarte |
| Control de versiones del código | Git + GitHub, un solo repo con carpetas `/backend` (Apps Script vía `clasp`) y `/frontend` (Vite) | `clasp` permite versionar y desplegar Apps Script desde código local en vez de editar en el navegador |

## 3. Referencias de código a revisar y qué rescatar de cada una

| Repositorio / fuente | Qué mirar | Qué rescatar | Qué NO usar |
|---|---|---|---|
| `ayastreb/money-tracker` (GitHub) | `src/entities/Transaction.ts`, `src/util/storage/pouchdb.js` | El modelo monto negativo/positivo según tipo, y el patrón de control de revisiones de PouchDB (`_rev`) como inspiración para la sincronización, ver sección 6 | Semantic UI React, toda su capa visual, su navegación de sidebar fijo, Auth0 |
| Chanchito (código propio, Apps Script) | Archivo completo `Code.gs` ya provisto | Todo el modelo de datos y casi todos los endpoints, corrigiendo validación numérica | Los espacios personales aislados por usuario, y la falta de validación antes de escribir en la hoja |
| Data real en `APPTELCOMAHORRO.xlsx` | Pestañas `Deudas` y `Presupuestos` | Sirve como caso de prueba real para la migración y para el test de validación (debe rechazar lo que generó los `#NUM!`) | — |

## 4. Modelo de datos (Google Sheets)

Se conserva el esquema de Chanchito con estos cambios:

- `Usuarios`: se agrega `telegram_chat_id` para mandar recordatorios por el bot.
- `Espacios`: al desplegar, se crea un único espacio compartido para todo el grupo, no un espacio personal por usuario.
- `Transacciones`, `Deudas`, `Presupuestos`: se agregan `rev` (entero, empieza en 1) y `origen` (`app` / `bot_texto` / `bot_foto`).
- `Notificaciones`: se agrega `canal` (`app` / `telegram`).
- Todo campo numérico (`monto`, `monto_original`, `monto_pendiente`, `monto_limite`) se valida con `parseFloat` en el backend antes de escribir; si el resultado es `NaN`, el endpoint devuelve error y no escribe nada. Este es el fix directo a los `#NUM!` que aparecen en la data real.

Pestañas y columnas completas: mantener exactamente las que ya usa Chanchito (`Usuarios`, `Espacios`, `MiembrosEspacio`, `Cuentas`, `Categorias`, `Transacciones`, `Evidencias`, `Deudas`, `PagosDeuda`, `Transferencias`, `Presupuestos`, `GastosRecurrentes`, `Etiquetas`, `TransaccionEtiquetas`, `Notificaciones`), con los agregados de arriba.

## 5. API de Apps Script

Mismo contrato de acciones que Chanchito (parámetro `action` en `doGet`/`doPost`), con estos cambios:

- Cada endpoint de escritura valida tipos antes de tocar la hoja, y responde `{ success: false, error: '...' }` sin escribir si algo no es válido.
- Cada escritura pasa por `LockService.getScriptLock()` antes de tocar la hoja, con timeout corto y reintento, porque con varias personas escribiendo casi simultáneo se pueden pisar filas.
- Nuevo endpoint `sincronizar`: recibe un lote de operaciones pendientes generadas offline (crear, editar) con su `rev` base, las aplica en orden, y devuelve tanto la confirmación de cada una como todo lo que cambió en el servidor desde la última sincronización del cliente.
- Nuevo endpoint `telegramWebhook`: recibe los updates del bot, ver sección 8.
- Cada request de escritura debe incluir un token compartido fijo (guardado en `PropertiesService` del script) que se valida al inicio de `doPost`/`doGet`, para no dejar el Web App totalmente abierto.

## 6. Sincronización offline con control de revisiones

Se descarta "último cambio gana" comparando fecha, que puede perder ediciones en silencio. En su lugar, control de revisiones simplificado, inspirado en el patrón `_rev` de PouchDB pero sin necesidad de hash:

- Cada transacción, deuda o presupuesto tiene un campo `rev`, entero, que empieza en 1 y sube en cada edición confirmada por el servidor.
- Al editar offline, el cliente guarda junto con el cambio el `rev` que tenía cuando empezó a editar (`rev_base`).
- Al sincronizar, el servidor compara `rev_base` contra el `rev` actual de ese registro:
  - Si coinciden, aplica el cambio normalmente y sube el `rev` en 1.
  - Si no coinciden, alguien más editó ese mismo registro entre medio. El servidor no sobrescribe, devuelve las dos versiones (la del cliente y la actual del servidor) marcadas como conflicto.
- El cliente muestra ese conflicto a la persona la próxima vez que abre la app, con ambas versiones lado a lado para que elija, en vez de perder el dato sin aviso.
- Con 10 personas donde cada quien edita mayormente lo suyo, este caso va a ser raro, pero cuando ocurra queda visible y resuelto por la persona, no perdido.

Guardado local: IndexedDB vía Dexie, con estado `sync_status: pending | synced | conflict` por registro. Service worker con Workbox cacheando el shell de la app para que abra sin conexión.

Nota de alcance: esta garantía de offline solo aplica a la PWA instalada directamente, no a cuando se abre a través de un botón dentro de Telegram, por las limitaciones del WebView de Telegram ya explicadas antes.

## 7. Bot de Telegram

- Webhook de Telegram apuntando al Web App de Apps Script, acción `telegramWebhook`.
- `/start`: registra el `chat_id` si el email o nombre coincide con un usuario ya dado de alta por el administrador, si no, responde que pida acceso.
- `/agregar <nombre> <email>` y `/quitar <nombre>`: solo para el propietario del espacio, alta y baja de usuarios.
- Registro por texto: interpretar monto y descripción de un mensaje libre, responder con botones de categoría antes de guardar.
- Registro por foto: descargar la imagen vía la API de archivos de Telegram, mandarla a Gemini pidiendo un JSON estructurado con monto, comercio, fecha y categoría sugerida de la lista cerrada, mostrar el resultado con botones de confirmar o corregir, subir la foto a Drive al confirmar.
- `/balance`: responde el resumen del mes sin abrir la app.
- Trigger diario de deudas: mismo chequeo que `verificarDeudasVencidas` en Chanchito, pero además de crear la notificación interna, manda el mensaje directo al `chat_id`.

## 8. Sistema de diseño

Dirección aprobada, estilo Apple (Wallet / Salud). No usar ninguna librería de componentes genéricos.

**Tokens de color**
```
--bg: #F5F5F7
--text: #1D1D1F
--accent: #0A84FF
--expense: #FF453A
--income: #30D158
```

**Tipografía:** `system-ui, -apple-system, 'Segoe UI', Inter, sans-serif`. Montos con `font-variant-numeric: tabular-nums`.

**Layout:** tarjetas apiladas, tarjeta hero con el saldo del mes (único lugar con vidrio esmerilado / blur), anillos de progreso por categoría como elemento firma, tab bar inferior fija con tres secciones (Resumen, Gastos, Deudas), sin menú hamburguesa ni sidebar.

**Pantallas mínimas:** Resumen (saldo + anillos), Gastos (lista filtrable, indicador de pendiente de sincronizar), Deudas (lista con vencimiento y botón de pago), Administración (solo propietario, alta/baja de usuarios).

## 9. Categorías predeterminadas

Gasto: Comida, Transporte, Gastos fijos, Servicios (internet, luz, agua), Salud, Educación, Entretenimiento, Otros gastos.
Ingreso: Sueldo, Ingresos extra, Otros ingresos.

Creadas automáticamente al desplegar, marcadas `es_sistema: true`, no editables ni eliminables. El propietario puede agregar categorías propias además de estas.

## 10. Checklist de funcionalidad

- [ ] Alta y baja de usuarios desde el bot y desde la pantalla de administración
- [ ] Registro de gasto/ingreso por texto en el bot
- [ ] Registro de gasto por foto de voucher con clasificación por Gemini
- [ ] Confirmación editable antes de guardar cualquier registro que venga del bot
- [ ] Registro y edición de transacciones desde la PWA, con y sin conexión
- [ ] Balance del mes y anillos por categoría en la pantalla de Resumen
- [ ] Deudas: alta, registro de pago parcial o total, cambio automático de estado al vencer
- [ ] Recordatorio de deuda por Telegram tres días antes del vencimiento
- [ ] Sincronización con control de revisiones y manejo visible de conflictos
- [ ] Comando `/balance` en el bot
- [ ] Migración de la data existente al espacio compartido único, descartando los registros corruptos (`#NUM!`, espacio huérfano `ESP001`)

## 11. Auditoría y calidad

- **Validación de datos:** todo endpoint de escritura rechaza montos no numéricos o campos obligatorios vacíos, con mensaje de error específico, nunca escribir data parcial o inválida en la hoja.
- **Concurrencia:** cobertura de `LockService` en cada escritura, con prueba manual de dos escrituras simultáneas para confirmar que no se pisan filas.
- **Seguridad:** token compartido validado en cada request de escritura, guardado en `PropertiesService`, nunca hardcodeado en el código fuente que se sube a GitHub.
- **Monitoreo:** Sentry en el frontend capturando errores de JS no manejados, y un endpoint de log en Apps Script que registre errores del backend en la hoja `Notificaciones` con tipo `sistema` para poder revisarlos.
- **Pruebas del backend:** usar `clasp` para desarrollo local del código de Apps Script, con pruebas unitarias en Jest para la lógica pura (cálculo de balances, validación de montos, cálculo de progreso de presupuesto), separando esa lógica de las llamadas directas a `SpreadsheetApp` para que sea testeable sin depender de Sheets real.
- **Prueba de conflicto de sincronización:** simular dos ediciones offline del mismo registro desde dos dispositivos y confirmar que el sistema muestra el conflicto en vez de perder una de las dos.
- **Revisión de diseño:** cada pantalla nueva se compara contra los tokens de la sección 8 antes de darla por terminada, ninguna pantalla debe usar colores o tipografía fuera de esa lista.

## 12. Configuración necesaria

- Spreadsheet de Google Sheets (reutilizar `TU_SPREADSHEET_ID` o uno limpio)
- Carpeta de Drive para evidencias (reutilizar `TU_DRIVE_FOLDER_ID`)
- Token del bot de Telegram (@BotFather)
- API key de Gemini
- Token compartido propio para proteger el Web App
- DSN de Sentry (capa gratuita)
- Repositorio en GitHub con GitHub Pages activado, carpetas `/backend` y `/frontend`

## 13. Fases de implementación

1. Backend: validaciones, espacio compartido único, campos de revisión, endpoint `sincronizar`
2. Migración de la data existente, limpiando los registros corruptos
3. Bot de Telegram: webhook, alta/baja de usuarios, registro por texto
4. Lectura de vouchers con Gemini y registro por foto
5. Frontend PWA con el sistema de diseño de la sección 8
6. Capa offline: Dexie, service worker, control de revisiones y UI de conflictos
7. Recordatorios de deudas por Telegram
8. Sentry y checklist de auditoría de la sección 11

## 14. Problemas del sistema anterior a no repetir

- Escribir montos sin validar (causó los `#NUM!` en Deudas y Presupuestos)
- Espacios personales aislados por usuario en vez de uno compartido real
- Ninguna forma rápida de capturar un gasto sin abrir un formulario web completo
- Ninguna forma de uso sin conexión
- Ningún monitoreo de errores en producción
