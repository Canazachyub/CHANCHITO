# Chanchito v2 — Guía de puesta en marcha desde cero

Guía operativa, paso a paso, para alguien que solo tiene este repo clonado y
ninguna otra configuración previa. Normativo: `docs/CONTRACT.md`. Referencia
rápida de endpoints del backend: `backend/README.md`.

Convención: `<ALGO>` es un valor que vos completás. Los comandos están pensados
para bash en Linux/macOS; en Windows usar Git Bash o WSL.

---

## 0. Prerrequisitos

- Node.js 18+ y npm (`node --version`, `npm --version`).
- Una cuenta de Google con acceso a Google Drive, Apps Script y Google Cloud
  Console (puede ser la misma cuenta para todo, es lo más simple para un
  grupo de ~10 personas).
- Cuenta de GitHub con este repo ya empujado (`git remote -v` debe mostrar tu
  fork/repo).
- Cuenta de Telegram (para crear el bot con @BotFather).

```bash
git clone <url-de-tu-fork> chanchito
cd chanchito
npm install              # dependencias raíz: Jest para /tests
cd frontend && npm install && cd ..   # dependencias del frontend
```

---

## 1. Crear o reutilizar el spreadsheet y la carpeta de Drive

`docs/CONTRACT.md` § 7 fija estos ids como los del proyecto original:

| Recurso | Id |
|---|---|
| Spreadsheet | `TU_SPREADSHEET_ID` |
| Carpeta de Drive (evidencias) | `TU_DRIVE_FOLDER_ID` |

**Opción A — reutilizar los existentes (recomendado si ya tenés la data vieja
de Chanchito v1):** no hace falta crear nada, solo confirmar que tu cuenta de
Google tiene acceso de edición a ese spreadsheet y esa carpeta. Abrilos en el
navegador para comprobarlo:
- `https://docs.google.com/spreadsheets/d/TU_SPREADSHEET_ID`
- `https://drive.google.com/drive/folders/TU_DRIVE_FOLDER_ID`

**Opción B — crear un ambiente limpio (recomendado para pruebas):**
1. Google Sheets → hoja en blanco → copiá el id de la URL
   (`.../spreadsheets/d/<ESTE_ID>/edit`).
2. Google Drive → "Nueva carpeta" → abrila → copiá el id de la URL
   (`.../folders/<ESTE_ID>`).
3. Usá esos dos ids en vez de los de la tabla en todo lo que sigue.

No hace falta crear pestañas a mano: `inicializarSistema()` (paso 5) las crea
todas con sus encabezados.

---

## 2. Instalar y autenticar clasp

```bash
npm install -g @google/clasp
clasp login
```

Esto abre el navegador para autorizar tu cuenta de Google. Si da error,
habilitar la Apps Script API en <https://script.google.com/home/usersettings>
(interruptor "Google Apps Script API" → activado) y reintentar.

### Vincular el proyecto de Apps Script

Si ya existe un proyecto de Apps Script (por ejemplo, reutilizando el que
tiene la hoja de cálculo original):

```bash
cd backend
cp .clasp.json.example .clasp.json
```

Editar `.clasp.json` y poner el `scriptId` real (Apps Script → ⚙️
Configuración del proyecto → "Id del script"). **No se versiona**: cada
desarrollador apunta a su propio deployment (está en `.gitignore`).

Si hay que crear un proyecto nuevo:

```bash
cd backend
clasp create --type webapp --title "Chanchito v2" --rootDir .
```

Esto genera `.clasp.json` automáticamente con el `scriptId` nuevo.

---

## 3. Push del backend y primer deploy

```bash
cd backend
clasp push
```

`clasp push` sube los `.js` como `.gs` (incluido `appsscript.json`, que ya
trae `timeZone: America/Lima` y los scopes de OAuth necesarios). Confirmá con
`clasp open` que los archivos aparecen en el editor web.

Antes de desplegar como Web App hace falta cargar las propiedades del script
(paso 4) — si desplegás antes, el primer request va a fallar con un error de
`getProp` ("Falta configurar la propiedad...").

---

## 4. Cargar las 8 propiedades de PropertiesService

`docs/CONTRACT.md` § 7. Ninguna va al código fuente: se cargan a mano, una
sola vez. Abrí el editor (`clasp open`) → ⚙️ Configuración del proyecto →
"Propiedades del script" → "Agregar propiedad del script", una por una:

| Clave | Valor | Cómo conseguirlo |
|---|---|---|
| `SPREADSHEET_ID` | el id del paso 1 | — |
| `DRIVE_FOLDER_ID` | el id del paso 1 | — |
| `SHARED_TOKEN` | una cadena aleatoria larga | `openssl rand -hex 24` |
| `TELEGRAM_WEBHOOK_SECRET` | otra cadena aleatoria, distinta de la anterior | `openssl rand -hex 24` |
| `TELEGRAM_BOT_TOKEN` | token de @BotFather | paso 7 |
| `GEMINI_API_KEY` | API key de Gemini | paso 8 |
| `SENTRY_DSN_BACKEND` | DSN del proyecto de Sentry | paso 9 |
| `GOOGLE_CLIENT_ID` | OAuth Client ID | paso 6 |

Como `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `SENTRY_DSN_BACKEND` y
`GOOGLE_CLIENT_ID` todavía no existen en este punto, cargá primero las 4
primeras y volvé a esta pantalla después de cada paso más adelante para
completar el resto. El sistema no arranca hasta tener las 8.

---

## 5. Desplegar el Web App y copiar su URL

Con al menos `SPREADSHEET_ID`, `DRIVE_FOLDER_ID` y `SHARED_TOKEN` cargados:

```bash
cd backend
clasp deploy --description "v2 - $(date +%Y-%m-%d)"
```

```bash
clasp deployments
```

Copiá el `deploymentId` más reciente y armá la URL:
`https://script.google.com/macros/s/<deploymentId>/exec`

Guardala: la vas a necesitar para el frontend, para el webhook de Telegram y
para probar la API a mano. Si corrés `clasp deploy` de nuevo sobre el mismo
deployment (sin crear uno nuevo con `--createDeployment`... en realidad
`clasp deploy` sin `-i` crea uno nuevo cada vez salvo que pases
`-i <deploymentId>` de un deployment existente), la URL puede cambiar — para
mantenerla fija, redeployá siempre con:

```bash
clasp deploy -i <deploymentId> --description "v2 - $(date +%Y-%m-%d)"
```

Prueba rápida (debería devolver un `TOKEN_INVALIDO` porque falta `token`):

```bash
curl "https://script.google.com/macros/s/<deploymentId>/exec?action=getUsuarios"
```

---

## 6. Crear el OAuth Client ID para Google Sign-In

Este es el paso que más falla y el que da errores más confusos ("origin not
allowed", "app no verificada", popup que se cierra solo sin mensaje). Seguirlo
al pie de la letra.

### 6.1 Configurar la pantalla de consentimiento OAuth

1. Ir a <https://console.cloud.google.com/> → crear un proyecto nuevo (o
   reutilizar uno) → **APIs y servicios → Pantalla de consentimiento de
   OAuth**.
2. Tipo de usuario: **Externo** (a menos que todo el grupo tenga cuentas de
   Google Workspace de un mismo dominio, en cuyo caso se puede usar
   "Interno").
3. Completar nombre de la app ("Chanchito"), correo de soporte, correo de
   contacto del desarrollador. El resto de los campos son opcionales.
4. **No mandar a revisión / no publicar.** Dejar la app en estado
   **"Testing" (Pruebas)**. Con ~10 usuarios conocidos esto alcanza y de paso
   evita el proceso de verificación de Google (que puede tardar semanas y no
   hace falta acá).
5. En la sección **"Usuarios de prueba"** (Test users) agregar el email de
   **cada una de las ~10 personas del grupo**, incluido el propietario. Esto
   es obligatorio: en estado "Testing", Google Sign-In **rechaza el login de
   cualquier cuenta que no esté en esta lista**, con un error tipo
   "Access blocked: Chanchito has not completed the Google verification
   process" que no menciona para nada el problema real (la lista de test
   users). Si agregás gente nueva al grupo más adelante, hay que volver acá y
   agregarla también.

### 6.2 Crear las credenciales

1. **APIs y servicios → Credenciales → + Crear credenciales → ID de cliente
   de OAuth**.
2. Tipo de aplicación: **Aplicación web** (no "Aplicación de escritorio" ni
   "Android/iOS" — Google Identity Services para la web necesita
   específicamente este tipo).
3. Nombre: "Chanchito Web" (o el que quieras, es solo para vos).
4. **Orígenes de JavaScript autorizados** — acá es donde más se falla. Hay
   que agregar **todos** los orígenes desde los que la app va a correr,
   **exactos**, sin path y **sin barra final**:
   - `http://localhost:5173` (Vite en desarrollo local; puerto por defecto
     de este proyecto según `frontend/vite.config.ts`).
   - `https://<tu-usuario-o-org>.github.io` (el origen de GitHub Pages —
     **sin** `/CHANCHITO/` al final: el origen es solo protocolo + host,
     el subpath no importa para este campo).
   - Si vas a probar con `vite preview` o algún otro puerto, agregalo
     también (por ejemplo `http://localhost:4173`).
5. **Orígenes de redirección autorizados**: dejar **vacío**. Google
   Identity Services con el flujo de "Sign In With Google" que usa este
   proyecto (`google.accounts.id.initialize` + botón / One Tap) es un flujo
   implícito de origen, no de redirect — si completás este campo pensando
   que hace falta, no rompe nada, pero no sirve para nada tampoco.
6. Guardar. Copiar el **Client ID** (termina en
   `.apps.googleusercontent.com`) — el **Client secret** no se usa en este
   proyecto (no hace falta, es un flujo 100% client-side + verificación del
   `id_token` en el backend contra `tokeninfo`).

### 6.3 Cargar el valor en los dos lugares

- Backend: `PropertiesService` → `GOOGLE_CLIENT_ID` (paso 4 de esta guía).
- Frontend: `frontend/.env.local` → `VITE_GOOGLE_CLIENT_ID` (ver paso 12).

### 6.4 Si sigue sin andar

- **Los cambios de origen autorizado tardan.** Google dice "unos minutos
  a unas horas" — si probás inmediatamente después de guardar y da error de
  origen, esperar 5-10 minutos y reintentar antes de asumir que algo está mal
  configurado.
- El origen tiene que matchear **carácter por carácter** con lo que ve el
  navegador en la barra de direcciones (protocolo incluido: `http` vs
  `https` son orígenes distintos).
- Si en algún momento cambiás de deployment de GitHub Pages a un dominio
  propio, hay que agregar ese origen nuevo también — los viejos no hace
  falta borrarlos.

---

## 7. Crear el bot en @BotFather y registrar el webhook

1. En Telegram, hablarle a **@BotFather** → `/newbot` → seguir las
   instrucciones (nombre, username terminado en `bot`).
2. BotFather devuelve un token tipo `123456789:ABC-...`. Cargarlo en
   `PropertiesService` → `TELEGRAM_BOT_TOKEN` (paso 4).
3. Con `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` ya cargados y el
   backend ya desplegado (paso 5), registrar el webhook:

```bash
TELEGRAM_BOT_TOKEN="<el-token-de-botfather>"
WEBAPP_URL="https://script.google.com/macros/s/<deploymentId>/exec"
TELEGRAM_WEBHOOK_SECRET="<el-mismo-valor-cargado-en-PropertiesService>"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBAPP_URL}?action=telegramWebhook&secreto=${TELEGRAM_WEBHOOK_SECRET}\", \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\"}"
```

En la URL va `TELEGRAM_WEBHOOK_SECRET` y **no** `SHARED_TOKEN`: Telegram guarda esa URL
en sus servidores, y si se filtra conviene rotar un secreto de un solo uso en lugar del
token que abre toda la API. Apps Script no expone headers HTTP, así que ese parámetro de
URL es la protección real — ver `docs/BOT.md` §2.

Debería responder `{"ok":true,"result":true,"description":"Webhook was set"}`.
Para confirmar:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

`url` debe mostrar la URL de arriba y `last_error_message` debe estar vacío
(si hay un error ahí, casi siempre es `token` o `secret_token` mal cargados,
o el deploy con acceso restringido — confirmar que `appsscript.json` tiene
`"access": "ANYONE_ANONYMOUS"`, ya viene así en este repo).

---

## 8. Obtener la API key de Gemini

1. <https://aistudio.google.com/app/apikey> → "Create API key" (podés
   reusar el mismo proyecto de Google Cloud del paso 6).
2. Cargarla en `PropertiesService` → `GEMINI_API_KEY` (paso 4).

---

## 9. Crear el proyecto de Sentry

1. <https://sentry.io/> → cuenta gratis → "Create Project".
2. Plataforma: **Google Apps Script** no existe como opción nativa; elegir
   **"JavaScript" (Node) genérico** — igual sirve, porque `02_util.js` manda
   los errores con un `UrlFetchApp.fetch` directo al DSN, no usa el SDK
   `@sentry/node`.
3. Copiar el **DSN** del proyecto (Settings → Client Keys (DSN)).
4. Cargarlo en `PropertiesService` → `SENTRY_DSN_BACKEND` (paso 4).
5. Crear un **segundo proyecto** de Sentry para el frontend (plataforma
   **React**), copiar su DSN, y ponerlo en `frontend/.env.local` como
   `VITE_SENTRY_DSN` (paso 13) — son DSN distintos porque son dos superficies
   de error separadas (backend en Apps Script, frontend en el navegador).

En este punto ya deberían estar cargadas las 8 propiedades del paso 4.
Confirmarlo abriendo `clasp open` → Configuración del proyecto → Propiedades
del script.

---

## 10. Correr `inicializarSistema()`

Con las 8 propiedades cargadas:

1. `clasp open` (o directo en el editor web de Apps Script).
2. Abrir el archivo `91_setup.js`.
3. En el selector de funciones de la barra superior, elegir
   `inicializarSistema` → botón ▶ Ejecutar.
4. Primera vez: Apps Script va a pedir autorización de permisos (Sheets,
   Drive, `UrlFetchApp`, etc.) — aceptar. Como el proyecto no está verificado
   por Google, va a mostrar una pantalla de advertencia ("Google hasn't
   verified this app"); esto es esperable para un script propio, click en
   "Advanced" → "Go to Chanchito v2 (unsafe)" → "Allow".
5. Revisar el log de ejecución (Ver → Registros de ejecución, o
   `Ctrl/Cmd+Enter`): reporta hojas creadas, hojas migradas (a las que les
   faltaba alguna columna del contrato v2), y confirma que quedaron creados
   **los dos espacios compartidos** — `ESP_FAMILIA` y `ESP_TELCOM`
   (`docs/CONTRACT.md` § 0.3) — cada uno con sus categorías de sistema
   (`docs/CONTRACT.md` § 6-bis: 11 categorías sin `grupo` en Familia, ~24
   categorías agrupadas en Familia/personal/activos/impuestos/ingresos en
   Telcom). Ya **no** existe un único `espacio_compartido: ESP_COMPARTIDO`
   como en versiones anteriores de esta guía.
6. Todos los usuarios activos son miembros de **ambos** espacios: no hace
   falta un alta separada por espacio, `inicializarSistema()` ya los deja
   accesibles desde el selector `Familia | Telcom` del frontend en cuanto se
   dan de alta (paso 14).

Es idempotente: se puede correr de nuevo sin duplicar nada.

---

## 11. Activar el trigger diario de obligaciones mensuales

Nuevo en esta versión (`docs/CONTRACT.md` § 4-ter): las obligaciones
mensuales (planilla, EsSalud, alquiler, seguros, etc.) se materializan solas
cada mes vía `generarObligacionesDelMes()`, pensada para correr desde un
trigger diario — igual que el resto de los triggers de `backend/50_triggers.js`
(recordatorio de deudas, recurrentes, presupuestos).

1. `clasp open` → ⏰ **Activadores** (ícono de reloj en la barra lateral).
2. **+ Agregar activador** → función a ejecutar: `generarObligacionesDelMes`
   (o el trigger consolidado de `50_triggers.js` si el agente de backend lo
   agrupó ahí — confirmar el nombre exacto en ese archivo antes de este paso).
3. Origen del evento: **Basado en tiempo** → **Temporizador de día** → elegir
   una franja horaria (por ejemplo 6:00–7:00, junto con el resto de los
   triggers diarios del sistema).
4. Guardar. Si Apps Script vuelve a pedir autorización de permisos, aceptar
   igual que en el paso 10.

Es idempotente por diseño (`ultimo_periodo_generado`, § 4-ter): que el
trigger corra varias veces el mismo día, o que se lo dispare a mano de más,
**nunca** duplica la deuda del mes — ver `docs/AUDITORIA.md` para el
procedimiento de verificación manual de esto antes de confiar en el trigger.
No hace falta crear ninguna obligación todavía en este paso: eso lo hace el
propietario después, desde Administración (o `crearObligacion` vía API) una
vez que hay al menos un usuario logueado (paso 14).

---

## 12. Migración de datos existentes (dry-run y luego real)

`backend/90_migracion.js`, acción `ejecutarMigracion` (POST). Requiere haber
corrido el paso 10 antes — necesita que **ambos** espacios (`ESP_FAMILIA` y
`ESP_TELCOM`) ya existan; si falta alguno responde `ERROR_INTERNO` pidiéndolo
explícitamente.

Es una acción con guardia `propietario`: además del `SHARED_TOKEN` necesita un
`token_sesion` de un usuario con `rol_global = propietario`. Se obtiene entrando
a la PWA con la cuenta del propietario y copiando el valor de la sesión, o
llamando a `login` con el `id_token` de Google. Reescribe data histórica: es
intencional que no se pueda disparar solo con la URL.

> **El destino por defecto es `ESP_TELCOM`, no `ESP_FAMILIA`.** El archivo de
> origen real, `APPTELCOMAHORRO.xlsx`, es la contabilidad de la **empresa**
> Telcom, no el gasto de la casa — mandarlo por defecto a Familia mezclaría
> facturación de empresa con mercado, exactamente lo que la separación en dos
> espacios (`docs/CONTRACT.md` § 0.3) busca evitar. Si en algún momento hace
> falta migrar un archivo que sí sea data familiar, pasar
> `"espacio_destino": "ESP_FAMILIA"` explícito en el body (ver 12.1/12.2). Un
> valor fuera de `ESP_FAMILIA`/`ESP_TELCOM` devuelve `ESPACIO_INVALIDO` sin
> tocar nada.

### 12.1 Simulación (no escribe nada)

```bash
WEBAPP_URL="https://script.google.com/macros/s/<deploymentId>/exec"
SHARED_TOKEN="<tu-shared-token>"
SESION="<token_sesion-del-propietario>"

curl -s -X POST "${WEBAPP_URL}?action=ejecutarMigracion&token=${SHARED_TOKEN}&sesion=${SESION}" \
  -H "Content-Type: text/plain;charset=utf-8" \
  -d '{}' | python3 -m json.tool
```

(`dry_run` no hace falta pasarlo: por defecto es simulación. Solo `dry_run: false`
explícito en el cuerpo habilita el modo que escribe. `espacio_destino` tampoco
hace falta pasarlo si el destino correcto es Telcom: es el valor por defecto.)

Revisar la respuesta: `data.espacio_destino` (confirmar que dice `ESP_TELCOM`
salvo que se haya pasado explícitamente lo contrario), `data.resumen` (cuántos
se migrarían, cuántos se descartarían) y `data.detalle` (fila por fila, con el
motivo, incluido el `grupo` inferido cuando aplica a una categoría de Telcom).
Es el momento de confirmar que los descartes tienen sentido (filas realmente
corruptas, no data válida con formato raro) antes de tocar nada de verdad.

### 12.2 Migración real

```bash
curl -s -X POST "${WEBAPP_URL}?action=ejecutarMigracion&token=${SHARED_TOKEN}&sesion=${SESION}" \
  -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"dry_run": false}' | python3 -m json.tool
```

Para migrar explícitamente a Familia en cambio: `-d '{"dry_run": false, "espacio_destino": "ESP_FAMILIA"}'`.

Revisar en el spreadsheet la hoja nueva **`MigracionLog`**: una fila por cada
registro migrado o descartado, con fecha, entidad, id, acción y motivo. Es el
mismo contenido que devolvió la respuesta JSON, pero queda persistido para
auditoría.

Correrla de nuevo (real, otra vez) debe devolver `resumen: { migrados: 0,
descartados: 0 }` y no agregar filas nuevas a `MigracionLog` — es la prueba
de que es idempotente.

> **Nota:** el archivo `APPTELCOMAHORRO.xlsx` no está en este repo. La
> migración está escrita contra el esquema documentado en `docs/CONTRACT.md`
> § 2 y § 6-bis, y contra el comportamiento real de `esFilaCorrupta`
> (`backend/lib_validacion.js`, cubierto por `tests/lib_validacion.test.js`),
> pero **no se corrió todavía contra la data real**. Antes de dar la
> migración por buena hay que correr el dry-run de este paso contra el
> spreadsheet real, revisar a mano los descartes, y confirmar que los nombres
> de categoría legacy efectivamente matchean los de § 6-bis para que la
> inferencia de `grupo` funcione (si no matchean, la categoría migra igual
> pero con `grupo` vacío, y se puede completar a mano después).

---

## 13. Configurar y compilar el frontend

```bash
cd frontend
cp .env.example .env.local
```

Editar `.env.local`:

```bash
VITE_API_URL=https://script.google.com/macros/s/<deploymentId>/exec
VITE_SHARED_TOKEN=<el-mismo-SHARED_TOKEN-de-PropertiesService>
VITE_GOOGLE_CLIENT_ID=<el-Client-ID-del-paso-6>
VITE_SENTRY_DSN=<el-DSN-del-proyecto-de-Sentry-del-frontend-del-paso-9>
```

Probar local:

```bash
npm run dev
```

Abrir `http://localhost:5173` (el origen tiene que estar en la lista del
paso 6.2). Todavía no va a poder hacer login real hasta el paso 14 (alta del
primer usuario).

---

## 14. Dar de alta el primer usuario propietario

Bootstrap: `crearUsuario` solo lo puede llamar alguien con sesión de
`rol_global='propietario'` (guardia en `01_router.js`), pero para tener esa
sesión primero necesitás un usuario propietario — hay que crear el primero a
mano, una sola vez, desde el editor de Apps Script:

1. `clasp open` → cualquier archivo del editor (por ejemplo `10_usuarios.js`).
2. Pegar temporalmente esta función al final del archivo (o en un archivo
   nuevo si preferís no ensuciar el versionado):

   ```js
   function _bootstrapPropietario() {
     var resultado = crearUsuario({
       nombre: 'Tu Nombre',
       email: 'tu-email@gmail.com',
       rol_global: 'propietario'
     });
     Logger.log(resultado);
   }
   ```

3. Seleccionar `_bootstrapPropietario` en el selector de funciones → ▶
   Ejecutar.
4. Ver el log (`Ctrl/Cmd+Enter`): debería mostrar
   `{ success: true, data: { id_usuario: 'USR_...' } }`.
5. **Borrar `_bootstrapPropietario`** del archivo (no se versiona: es un
   script de arranque de una sola vez) y `clasp push` de nuevo para que el
   proyecto remoto quede limpio.

A partir de acá, ese email ya puede hacer login real en el frontend
(Google Sign-In) y, como es el propietario, dar de alta al resto del grupo
desde la pantalla de Administración (o repitiendo `crearUsuario` vía la API
una vez logueado, sin necesidad de tocar el editor de nuevo).

---

## 15. Activar GitHub Pages

El repo ya trae el workflow `.github/workflows/deploy.yml`: en cada push a
`main` que toque `frontend/**`, hace `npm ci && npm run build` dentro de
`frontend/` y publica `frontend/dist` a GitHub Pages. Solo falta habilitarlo
y cargarle los secrets:

1. En GitHub → Settings del repo → **Pages** → **Source: GitHub Actions**
   (no "Deploy from a branch" — el workflow ya usa
   `actions/deploy-pages`, que requiere este modo).
2. En GitHub → Settings del repo → **Secrets and variables → Actions →
   New repository secret**, cargar los mismos 4 valores que pusiste en
   `frontend/.env.local` (paso 13) — el workflow los inyecta como variables
   de entorno del build (`env:` del job `build` en `deploy.yml`):
   - `VITE_API_URL`
   - `VITE_SHARED_TOKEN`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_SENTRY_DSN`
3. Empujar un commit a `main` que toque algo en `frontend/` (o disparar el
   workflow a mano: pestaña **Actions** → "Deploy frontend a GitHub Pages" →
   **Run workflow**, gracias a que tiene `workflow_dispatch`).
4. Confirmar que la URL resultante coincide con el origen que cargaste en el
   paso 6.2 (`https://<usuario>.github.io`, y la app sirve bajo
   `/CHANCHITO/` por el `base` de `vite.config.ts`) — si no coincide
   exactamente, el login con Google va a fallar por origen no autorizado.
5. Abrir `https://<usuario>.github.io/CHANCHITO/` y probar el login real.

---

## 16. Checklist final

- [ ] `npm test` (raíz) corre limpio.
- [ ] `inicializarSistema()` corrido, log revisado: existen `ESP_FAMILIA` y
      `ESP_TELCOM`, cada uno con sus categorías de sistema (§ 6-bis).
- [ ] Trigger diario de `generarObligacionesDelMes` activado (paso 11).
- [ ] Migración corrida en dry-run, revisada, y después en real; `MigracionLog`
      tiene sentido; se confirmó que `data.espacio_destino` fue el esperado
      (`ESP_TELCOM` por defecto — la data de `APPTELCOMAHORRO.xlsx` es de la
      empresa, no de la casa).
- [ ] Las 8 propiedades del script cargadas (paso 4).
- [ ] Login con Google funciona en `http://localhost:5173` y en GitHub Pages.
- [ ] Primer usuario propietario dado de alta y logueado, y es miembro de
      ambos espacios (lo hace `inicializarSistema()` automáticamente).
- [ ] Webhook de Telegram registrado (`getWebhookInfo` sin `last_error_message`).
- [ ] `/start` en el bot vincula el `chat_id` del propietario.
- [ ] El bot pregunta el espacio (`¿Familia o Telcom?`) antes de pedir el
      usuario en cada registro (`docs/CONTRACT.md` § 5).
- [ ] Ver `docs/AUDITORIA.md` para la verificación completa de calidad antes
      de dar el sistema por listo para el grupo — en particular, aislamiento
      entre espacios, no-doble-aprobación de solicitudes, e idempotencia de la
      generación mensual de obligaciones.
