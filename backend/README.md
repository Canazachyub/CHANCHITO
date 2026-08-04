# Chanchito v2 — Backend (Google Apps Script)

Backend serverless sobre Apps Script + Google Sheets. Se despliega y versiona con
`clasp`. La fuente de verdad del contrato de API es
[`docs/CONTRACT.md`](../docs/CONTRACT.md); este documento es solo la guía operativa
para instalar, configurar y desplegar.

## 1. Instalar clasp

```bash
npm install -g @google/clasp
clasp login
```

`clasp login` abre el navegador para autorizar tu cuenta de Google. Necesitas
tener habilitada la Apps Script API en https://script.google.com/home/usersettings.

## 2. Vincular el proyecto

Si el proyecto de Apps Script ya existe (recomendado: reutilizar el que tiene la
hoja de cálculo con la data real):

```bash
cd backend
cp .clasp.json.example .clasp.json
# Editar .clasp.json y poner el scriptId real (Apps Script > Configuración del proyecto > ID del script).
```

Si hay que crear uno nuevo desde cero:

```bash
cd backend
clasp create --type webapp --title "Chanchito v2" --rootDir .
```

`.clasp.json` está en `.gitignore` (no se versiona: cada desarrollador apunta a su
propio deployment de pruebas). Solo se versiona `.clasp.json.example`.

## 3. Cargar las propiedades del script

Ninguna credencial va al código fuente. Se cargan a mano, una sola vez, desde
**Apps Script > Configuración del proyecto > Propiedades del script**, o por CLI:

```bash
clasp run --params '[...]'   # o, más simple, desde el editor web:
```

Desde el editor de Apps Script (`clasp open`) → ⚙️ Configuración del proyecto →
Propiedades del script → agregar cada una:

| Clave | Uso | Ejemplo |
|---|---|---|
| `SHARED_TOKEN` | Token compartido que valida todo request | una cadena aleatoria larga |
| `TELEGRAM_BOT_TOKEN` | Token de @BotFather | `123456:ABC-...` |
| `TELEGRAM_WEBHOOK_SECRET` | Secreto del header `X-Telegram-Bot-Api-Secret-Token` | otra cadena aleatoria |
| `GEMINI_API_KEY` | API key de Gemini | `AIza...` |
| `SENTRY_DSN_BACKEND` | Webhook de Sentry para errores del backend | URL del DSN |
| `SPREADSHEET_ID` | Id de la hoja de cálculo | `TU_SPREADSHEET_ID` |
| `DRIVE_FOLDER_ID` | Carpeta de Drive para evidencias | `TU_DRIVE_FOLDER_ID` |
| `GOOGLE_CLIENT_ID` | OAuth Client ID para validar el `id_token` de Google Sign-In | `....apps.googleusercontent.com` |

`00_config.js` las lee con `getProp(clave)`, que lanza un error claro si falta
alguna.

## 4. Inicializar las hojas

Con las propiedades ya cargadas, desde el editor de Apps Script:

1. Abrir `91_setup.js`.
2. Ejecutar la función `inicializarSistema` (menú Ejecutar ▶ o `Ctrl/Cmd+R`).
3. Revisar el log de ejecución: reporta hojas creadas, hojas migradas (a las
   que les faltaba alguna columna del contrato) y confirma los dos espacios
   `ESP_FAMILIA` y `ESP_TELCOM` (docs/CONTRACT.md § 0.3).

Es idempotente: se puede correr varias veces sin duplicar hojas, espacios,
categorías de sistema, cuentas por defecto ni membresías.

Si la hoja `Espacios` todavía tiene el `ESP_COMPARTIDO` único de una versión
anterior, `inicializarSistema` lo **renombra** a `ESP_FAMILIA` (y reasigna
`id_espacio` en cascada en todas las hojas que lo referencian) en vez de crear
un espacio nuevo vacío al lado — así ninguna cuenta, categoría, transacción o
deuda existente queda huérfana. `ESP_TELCOM` siempre se crea nuevo, vacío. La
respuesta de `inicializarSistema` incluye `espacio_legacy_reutilizado: true`
cuando esto pasó.

Si hay data existente que migrar desde el Chanchito original (registros con
`#NUM!`, el espacio huérfano `ESP001`, etc.), eso lo hace `ejecutarMigracion`
(ver `backend/90_migracion.js`, de otro agente) — `inicializarSistema` solo
prepara la estructura de las hojas.

## 5. Desplegar

```bash
cd backend
clasp push          # sube el código
clasp deploy --description "v2 - <fecha>"
```

`clasp push` sube los `.js` como `.gs` (mismo contenido, Apps Script ignora la
extensión real del archivo en disco). La URL del Web App queda fija entre
despliegues si se usa `clasp deploy` sobre el mismo deployment id
(`clasp deployments` para listarlos).

Tras el primer deploy, copiar la URL del Web App (termina en `/exec`) para:
- Configurarla como endpoint en el frontend (`frontend/src/data/api.ts`, de otro agente).
- Configurar el webhook de Telegram: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_WEBAPP>?action=telegramWebhook%26token=<SHARED_TOKEN>&secret_token=<TELEGRAM_WEBHOOK_SECRET>`.

## 6. Desarrollo local / tests

La lógica pura (`lib_validacion.js`, `lib_calculos.js`, `lib_sync.js`) no toca
`SpreadsheetApp` y se prueba con Jest desde `/tests` sin necesidad de Apps
Script ni de `clasp`:

```bash
cd ..            # raíz del repo
npm test
```

El resto de archivos (`00_config.js` en adelante) solo corre dentro de Apps
Script; para probarlos hay que desplegar y pegarle al Web App real (o usar
`clasp run <función>` para ejecutar una función suelta desde la CLI).

## 7. Tabla de endpoints

Todo request lleva `?action=<accion>&token=<SHARED_TOKEN>` en la URL. Los que
requieren sesión llevan además `&sesion=<token_sesion>` (el que devuelve
`login`). El body de POST es JSON; GET usa parámetros de URL. Toda respuesta
tiene la forma `{ success, data }` o `{ success:false, error, detalle }`.

### Autenticación

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `login` | POST | token | `{ id_token }` (id_token de Google Sign-In) |

### Usuarios

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getUsuario` | GET | sesión | `?id_usuario=` |
| `getUsuarios` | GET | sesión | — |
| `crearUsuario` | POST | propietario | `{ nombre, email, moneda_principal?, telegram_chat_id? }` — agrega al usuario como miembro de **ambos** espacios |
| `actualizarUsuario` | POST | sesión (propio, o propietario para editar a otros) | `{ id_usuario, ...campos }` |
| `desactivarUsuario` | POST | propietario | `{ id_usuario }` — baja lógica en Usuarios y en su membresía de ambos espacios |

### Espacios

Dos espacios compartidos por todo el grupo — `ESP_FAMILIA` y `ESP_TELCOM`
(docs/CONTRACT.md § 0.3). No hay espacios personales. Toda acción de dominio
recibe `id_espacio` explícito y el router valida que el usuario de la sesión
sea miembro activo de ese espacio antes de invocarla (`ESPACIO_INVALIDO` si el
espacio no existe, `NO_ES_MIEMBRO` si el usuario no pertenece a él).

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getEspacio` | GET | sesión | `?id_espacio=` (requerido) |
| `getEspacios` | GET | sesión | — devuelve los espacios de los que el usuario de la sesión es miembro activo (normalmente los dos) |
| `getMiembros` | GET | sesión | `?id_espacio=` (requerido) |
| `actualizarEspacio` | POST | propietario | `{ id_espacio, nombre?, descripcion?, icono?, color? }` |

### Cuentas

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getCuentas` | GET | sesión | `?id_espacio=` |
| `getCuenta` | GET | sesión | `?id_cuenta=` |
| `getBalanceCuenta` | GET | sesión | `?id_cuenta=` |
| `crearCuenta` | POST | sesión | `{ id_espacio, nombre, tipo?, saldo_inicial?, moneda?, color?, icono?, orden? }` |
| `actualizarCuenta` | POST | sesión | `{ id_cuenta, ...campos }` |
| `eliminarCuenta` | POST | sesión | `{ id_cuenta }` |

### Categorías

Cada espacio tiene su propio catálogo de categorías de sistema
(docs/CONTRACT.md § 6-bis): las 11 de Familia (README § 9, sin agrupar) y las
20+ de Telcom, agrupadas por `grupo` (`operativos`, `personal`, `activos`,
`impuestos`, `ingresos`; `''` en Familia y en "Otros gastos operativos").

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getCategorias` | GET | sesión | `?id_espacio=&tipo=gasto\|ingreso&grupo=` (`id_espacio` requerido; `grupo` filtra si se pasa) |
| `crearCategoria` | POST | sesión | `{ id_espacio, nombre, tipo, icono?, color?, grupo?, orden? }` |
| `actualizarCategoria` | POST | sesión | `{ id_categoria, ...campos }` (rechaza `es_sistema=true`) |
| `eliminarCategoria` | POST | sesión | `{ id_categoria }` (rechaza `es_sistema=true`) |

### Transacciones

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getTransacciones` | GET | sesión | `?id_espacio=&fecha_inicio=&fecha_fin=&tipo=&id_categoria=&id_cuenta=` |
| `getTransaccion` | GET | sesión | `?id_transaccion=` |
| `crearTransaccion` | POST | sesión | `{ id_espacio, id_cuenta, id_categoria, tipo, monto, descripcion?, fecha?, hora?, notas?, origen? }` |
| `actualizarTransaccion` | POST | sesión | `{ id_transaccion, ...campos }` |
| `eliminarTransaccion` | POST | sesión | `{ id_transaccion }` (lógico: `eliminado=true`) |

### Evidencias

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getEvidencias` | GET | sesión | `?id_transaccion=` |
| `subirEvidencia` | POST | sesión | `{ id_transaccion, contenido_base64, nombre_archivo, mime_type?, tipo? }` |
| `eliminarEvidencia` | POST | sesión | `{ id_evidencia }` |

### Deudas

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getDeudas` | GET | sesión | `?id_espacio=&tipo=me_deben\|debo&estado=` |
| `getDeuda` | GET | sesión | `?id_deuda=` |
| `getPagosDeuda` | GET | sesión | `?id_deuda=` |
| `crearDeuda` | POST | sesión | `{ id_espacio, tipo, persona, monto_original, fecha_vencimiento?, notas?, recordatorio? }` |
| `actualizarDeuda` | POST | sesión | `{ id_deuda, ...campos }` |
| `eliminarDeuda` | POST | sesión | `{ id_deuda }` (lógico) |
| `registrarPagoDeuda` | POST | sesión | `{ id_deuda, monto, fecha?, notas?, id_transaccion? }` |

### Transferencias

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getTransferencias` | GET | sesión | `?id_espacio=&fecha_inicio=&fecha_fin=` |
| `realizarTransferencia` | POST | sesión | `{ cuenta_origen, cuenta_destino, monto, fecha?, nota? }` |

### Presupuestos

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getPresupuestos` | GET | sesión | `?id_espacio=&mes=&anio=` |
| `getProgresoPresupuesto` | GET | sesión | `?id_presupuesto=` |
| `crearPresupuesto` | POST | sesión | `{ id_espacio, id_categoria, monto_limite, mes, anio, alerta_porcentaje? }` |
| `actualizarPresupuesto` | POST | sesión | `{ id_presupuesto, ...campos }` |
| `eliminarPresupuesto` | POST | sesión | `{ id_presupuesto }` (lógico) |

### Gastos recurrentes

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getGastosRecurrentes` | GET | sesión | `?id_espacio=` |
| `crearGastoRecurrente` | POST | sesión | `{ id_espacio, id_categoria, id_cuenta, descripcion, monto, frecuencia, dia_ejecucion? }` |
| `actualizarGastoRecurrente` | POST | sesión | `{ id_gasto_recurrente, ...campos }` |
| `eliminarGastoRecurrente` | POST | sesión | `{ id_gasto_recurrente }` |
| `ejecutarGastoRecurrente` | POST | sesión | `{ id_gasto_recurrente }` |

### Etiquetas

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getEtiquetas` | GET | sesión | `?id_espacio=` |
| `crearEtiqueta` | POST | sesión | `{ id_espacio, nombre, color? }` |
| `eliminarEtiqueta` | POST | sesión | `{ id_etiqueta }` |
| `asignarEtiqueta` | POST | sesión | `{ id_transaccion, id_etiqueta }` |
| `removerEtiqueta` | POST | sesión | `{ id_transaccion, id_etiqueta }` |

### Notificaciones

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getNotificaciones` | GET | sesión | `?id_usuario=&leida=true\|false` |
| `marcarNotificacionLeida` | POST | sesión | `{ id_notificacion }` |
| `marcarTodasLeidas` | POST | sesión | `{ id_usuario? }` (default: el de la sesión) |

### Dashboard

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getDashboard` | GET | sesión | `?id_espacio=&mes=&anio=` |
| `getResumenMensual` | GET | sesión | `?id_espacio=&mes=&anio=` |
| `getTendencia` | GET | sesión | `?id_espacio=&meses=` |
| `getTopCategorias` | GET | sesión | `?id_espacio=&mes=&anio=&limite=` |

### Sincronización offline

El lote, sus resultados y los `cambios` devueltos son **por espacio**
(docs/CONTRACT.md § 0.3 y § 4): el request lleva `id_espacio` y solo se
aplican/devuelven operaciones de ese espacio. Una operación cuyo registro
pertenece a otro espacio se rechaza con `NO_ES_MIEMBRO` sin abortar el resto
del lote; una operación `crear` siempre escribe en el espacio del lote, sin
importar lo que traiga `datos.id_espacio`.

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `sincronizar` | POST | sesión | `{ id_espacio, desde, operaciones: [{ op_id, tipo, entidad, id, rev_base, datos }] }` — ver § 4 de `docs/CONTRACT.md` |

### Solicitudes de dinero y obligaciones mensuales

Implementadas en `backend/23_solicitudes.js` y `backend/24_obligaciones.js`
(otro agente, en paralelo) — docs/CONTRACT.md § 4-bis y § 4-ter. El router
(`01_router.js`) solo delega con los nombres de función exactos del contrato.
No son entidades sincronizables: no llevan `rev` ni entran en `sincronizar`.

| Acción | Método | Auth | Payload |
|---|---|---|---|
| `getSolicitudes` | GET | sesión | `?id_espacio=&estado=` (filtrable, ambos opcionales) |
| `crearSolicitud` | POST | sesión | `{ id_espacio, monto, motivo, id_categoria }` |
| `responderSolicitud` | POST | propietario | `{ id_solicitud, aprobar, motivo? }` |
| `getObligaciones` | GET | sesión | `?id_espacio=` (filtrable, opcional) |
| `crearObligacion` | POST | propietario | `{ id_espacio, concepto, id_categoria, id_cuenta, monto_estimado, dia_vencimiento }` |
| `actualizarObligacion` | POST | propietario | `{ id_obligacion, ...campos }` |
| `eliminarObligacion` | POST | propietario | `{ id_obligacion }` (baja lógica) |
| `generarObligacionesDelMes` | POST | sesión | — idempotente por mes; la dispara también el trigger diario directo |

### Otros

| Acción | Método | Auth | Payload | Nota |
|---|---|---|---|---|
| `telegramWebhook` | POST | token propio | updates de Telegram | Implementado en `40_telegram.js` (otro agente) |
| `ejecutarMigracion` | GET/POST | propia | — | Implementado en `90_migracion.js` (otro agente) |
| `logError` | POST | token | `{ mensaje, ... }` | Registra en `Notificaciones` (tipo=sistema) y reporta a Sentry |

## 8. Códigos de error

`TOKEN_INVALIDO`, `USUARIO_NO_AUTORIZADO`, `SESION_INVALIDA`, `MONTO_INVALIDO`,
`CAMPO_REQUERIDO`, `FECHA_INVALIDA`, `NO_ENCONTRADO`, `SIN_PERMISO`,
`CONFLICTO_REV` (usado en el estado `conflicto` de `sincronizar`),
`LOCK_TIMEOUT`, `EMAIL_DUPLICADO` (`crearUsuario` con un email ya activo),
`ESPACIO_INVALIDO` (el `id_espacio` no existe o no está activo),
`NO_ES_MIEMBRO` (el usuario de la sesión no es miembro activo del espacio, o
la operación de `sincronizar` pertenece a un espacio distinto del lote),
`SOLICITUD_YA_RESPONDIDA`, `ERROR_INTERNO`.
