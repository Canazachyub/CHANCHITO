# Chanchito v2 — Auditoría y calidad

Checklist verificable de `README.md` § 11. Para cada punto: qué se comprueba,
cómo comprobarlo paso a paso, y una casilla de estado. Pensado para correrse
una vez que `docs/SETUP.md` está completo (backend desplegado, propiedades
cargadas, al menos un usuario de prueba dado de alta).

Estado de esta auditoría la primera vez que se escribió este documento:
sección 5 (tests de Jest) verificada y en verde; el resto queda con la
casilla sin marcar porque requiere un backend ya desplegado contra el
spreadsheet real, algo que este agente no tiene forma de hacer (ver
`docs/SETUP.md` § 12, nota sobre `APPTELCOMAHORRO.xlsx`). Quien despliegue el
sistema debe recorrer cada sección y marcar la casilla al confirmarla.

Actualización tras el cambio a dos espacios (`ESP_FAMILIA`/`ESP_TELCOM`,
solicitudes de dinero y obligaciones mensuales, `docs/CONTRACT.md` § 0.3,
§ 4-bis, § 4-ter): se agregaron las secciones 8, 9 y 10. La parte automática
de la 8 quedó verificada (corre contra código real de `backend/lib_calculos.js`);
las de 9 y 10 están escritas y listas pero varias quedan en espera de que el
agente de backend extraiga la lógica pura correspondiente — ver el detalle en
cada sección.

---

## 1. Validación de datos

**Qué se comprueba:** todo endpoint de escritura rechaza montos no numéricos
o campos obligatorios vacíos, con un código de error específico, y **nunca**
escribe data parcial o inválida en la hoja.

**Cómo comprobarlo:**

1. Automático (cubre la lógica de validación en sí, sin red):
   `npm test` desde la raíz — `tests/lib_validacion.test.js` prueba
   `validarMonto` contra la lista completa de casos del README § 14 (NaN,
   null, `''`, `'#NUM!'`, `'#REF!'`, `'#VALUE!'`, texto, `Infinity`,
   negativos, `> 1e9`, objetos, arrays) y los casos que debe aceptar
   (`45.9`, `'45.90'`, `'45,90'` → `45.9`, `0`, el límite `1e9`).
2. Manual, contra el backend real (reemplazar `<...>` por los valores del
   deploy):

   ```bash
   WEBAPP_URL="https://script.google.com/macros/s/<deploymentId>/exec"
   TOKEN="<SHARED_TOKEN>"
   SESION="<token_sesion de un login real>"

   curl -s -X POST "${WEBAPP_URL}?action=crearTransaccion&token=${TOKEN}&sesion=${SESION}" \
     -H "Content-Type: application/json" \
     -d '{"id_cuenta":"<id_cuenta_real>","id_categoria":"<id_categoria_real>","tipo":"gasto","monto":"#NUM!"}'
   ```

   Debe responder `{"success":false,"error":"MONTO_INVALIDO", ...}` **sin**
   crear ninguna fila. Confirmar en el spreadsheet (pestaña `Transacciones`)
   que no apareció ninguna fila nueva.
3. Repetir omitiendo un campo requerido (por ejemplo sin `id_cuenta`): debe
   responder `CAMPO_REQUERIDO` y tampoco escribir nada.
4. Repetir con una fecha imposible (`"fecha":"2026-02-30"`): debe responder
   `FECHA_INVALIDA`.

**Dónde vive en el código:** `backend/lib_validacion.js` (`validarMonto`,
`validarRequeridos`, `validarFecha`), invocado desde cada `preparar<Entidad>`
en `backend/14_transacciones.js`, `16_deudas.js`, `18_presupuestos.js`, etc.
**antes** de cualquier `appendRow`/`escribirCampos` — ningún endpoint de
escritura toca la hoja sin pasar primero por `preparar*`.

- [ ] Verificado contra el backend desplegado.

---

## 2. Concurrencia

**Qué se comprueba:** toda escritura pasa por `LockService`, con prueba
manual de dos escrituras simultáneas para confirmar que no se pisan filas.

**Dónde vive en el código:** `backend/02_util.js` → `withLock(fn)`
(`LockService.getScriptLock()`, `tryLock(10000)` con un reintento de 10s más;
si ambos fallan devuelve `LOCK_TIMEOUT` sin ejecutar `fn`). Todo endpoint de
escritura (`crearTransaccion`, `actualizarDeuda`, `sincronizar`, etc.) envuelve
su escritura real en `withLock(...)`.

**Cómo comprobarlo (prueba manual de dos escrituras simultáneas):**

1. Crear una transacción de prueba y anotar su `id_transaccion` y su `rev`
   (por ejemplo vía `getTransaccion`).
2. Lanzar dos `actualizarTransaccion` **al mismo tiempo** contra esa misma
   fila, con valores distintos, en paralelo real (no uno atrás del otro):

   ```bash
   WEBAPP_URL="https://script.google.com/macros/s/<deploymentId>/exec"
   TOKEN="<SHARED_TOKEN>"
   SESION="<token_sesion>"
   ID_TRX="<id_transaccion_de_prueba>"

   curl -s -X POST "${WEBAPP_URL}?action=actualizarTransaccion&token=${TOKEN}&sesion=${SESION}" \
     -H "Content-Type: application/json" \
     -d "{\"id_transaccion\":\"${ID_TRX}\",\"descripcion\":\"Escritura A\"}" &

   curl -s -X POST "${WEBAPP_URL}?action=actualizarTransaccion&token=${TOKEN}&sesion=${SESION}" \
     -H "Content-Type: application/json" \
     -d "{\"id_transaccion\":\"${ID_TRX}\",\"descripcion\":\"Escritura B\"}" &

   wait
   ```

3. Traer la fila de nuevo (`getTransaccion`). Verificar:
   - La fila tiene **una** de las dos descripciones completas
     (`"Escritura A"` o `"Escritura B"`), nunca un valor mezclado/corrupto
     (por ejemplo mitad de un string y mitad del otro, que es lo que pasaría
     sin lock si dos `setValue` se pisaran a mitad de escritura).
   - El `rev` subió exactamente en 2 respecto del valor anotado en el paso 1
     (una vez por cada escritura aplicada en serie gracias al lock), no en 1
     (lo que indicaría que una se perdió) ni quedó en un estado inconsistente.
4. Repetir el mismo experimento con **20-30 requests en paralelo** contra la
   misma fila para forzar contención real de `LockService` (con solo 2 el
   lock casi nunca llega a bloquear de verdad porque Apps Script ya es
   bastante rápido):

   ```bash
   for i in $(seq 1 30); do
     curl -s -X POST "${WEBAPP_URL}?action=actualizarTransaccion&token=${TOKEN}&sesion=${SESION}" \
       -H "Content-Type: application/json" \
       -d "{\"id_transaccion\":\"${ID_TRX}\",\"notas\":\"intento-${i}\"}" &
   done
   wait
   ```

   Ninguna respuesta debería venir corrupta; algunas pueden venir con
   `LOCK_TIMEOUT` si 30 simultáneas exceden los ~20s totales de espera del
   lock — es el comportamiento esperado y documentado (mejor fallar
   explícito que escribir mal), no una falla de la prueba.

- [ ] Verificado contra el backend desplegado (prueba de 2 escrituras).
- [ ] Verificado con contención mayor (20-30 escrituras simultáneas).

---

## 3. Seguridad

**Qué se comprueba:** token compartido validado en cada request de escritura,
guardado en `PropertiesService`, nunca hardcodeado en el código fuente que se
sube a GitHub.

**Cómo comprobarlo:**

1. Estático — confirmar que no hay secretos en el repo:

   ```bash
   grep -rniE "SHARED_TOKEN\s*=\s*['\"]|TELEGRAM_BOT_TOKEN\s*=\s*['\"]|GEMINI_API_KEY\s*=\s*['\"]|SENTRY_DSN.*=\s*['\"]https?://" \
     --include='*.js' --include='*.ts' --include='*.tsx' backend/ frontend/src/ 2>/dev/null
   ```

   No debería devolver nada (todas las lecturas pasan por `getProp(clave)`
   en `backend/00_config.js` o por `import.meta.env.VITE_*` en el
   frontend). Confirmar también que `backend/.clasp.json` (el real, con el
   `scriptId` de cada desarrollador) y `frontend/.env.local` **no** están
   commiteados: `git ls-files | grep -E '\.clasp\.json$|\.env\.local$'` debe
   devolver vacío — están en `.gitignore`.
2. Request sin `token` o con uno incorrecto:

   ```bash
   curl -s "https://script.google.com/macros/s/<deploymentId>/exec?action=getUsuarios"
   curl -s "https://script.google.com/macros/s/<deploymentId>/exec?action=getUsuarios&token=incorrecto"
   ```

   Ambos deben responder `{"success":false,"error":"TOKEN_INVALIDO", ...}`
   sin ejecutar `getUsuarios`. Ver `backend/01_router.js`,
   `_manejarRequest`: el chequeo de `SHARED_TOKEN` corre antes de resolver
   cualquier acción de la tabla, con una **única** excepción:
   `telegramWebhook`, que llama Telegram y no puede mandar nuestro token, así
   que valida `?secreto=<TELEGRAM_WEBHOOK_SECRET>` por su cuenta
   (`backend/40_telegram.js`, `tgSecretoValido`).
3. Acción que requiere sesión, sin `sesion` o con una vencida/inventada:
   debe responder `SESION_INVALIDA` (`backend/03_auth.js`,
   `requiereSesion`).
4. Acción de propietario (`crearUsuario`, `desactivarUsuario`,
   `actualizarEspacio`, `ejecutarMigracion`) con sesión de un usuario
   `rol_global='miembro'`: debe responder `SIN_PERMISO` (`requierePropietario`).
   Probar `ejecutarMigracion` explícitamente: es la acción más destructiva del
   sistema y la que más fácil se deja expuesta por descuido.
5. Confirmar que `appsscript.json` tiene `"access": "ANYONE_ANONYMOUS"` (Web
   App accesible sin cuenta de Google previa) — es intencional: la
   autenticación real la hace el `id_token` de Google Sign-In + el
   `SHARED_TOKEN`, no el mecanismo de acceso del Web App de Apps Script.

- [ ] Sin secretos en el código fuente ni archivos de config reales commiteados.
- [ ] `TOKEN_INVALIDO` / `SESION_INVALIDA` / `SIN_PERMISO` verificados contra el backend real.

---

## 4. Monitoreo

**Qué se comprueba:** Sentry en el frontend capturando errores de JS no
manejados, y un endpoint de log en Apps Script que registre errores del
backend en `Notificaciones` (`tipo='sistema'`).

**Cómo comprobarlo:**

1. Backend — forzar un error real (por ejemplo llamando a una acción con un
   `id_deuda` que no existe, o revisando el catch genérico de
   `_manejarRequest` en `backend/01_router.js`, que llama a
   `registrarErrorSistema` y `reportarSentry` en cualquier excepción no
   controlada). Confirmar en la pestaña `Notificaciones` del spreadsheet que
   aparece una fila con `tipo='sistema'`, `id_usuario='SISTEMA'` y el
   mensaje del error (ver `backend/02_util.js`,
   `registrarErrorSistema`/`reportarSentry`).
2. Confirmar que `SENTRY_DSN_BACKEND` está cargado y que el proyecto de
   Sentry del backend efectivamente recibe el evento (Sentry → Issues,
   filtrando por el proyecto creado en `docs/SETUP.md` § 9).
3. Frontend — con la app corriendo (`npm run dev` o el deploy de GitHub
   Pages) y `VITE_SENTRY_DSN` cargado, forzar un error en la consola del
   navegador o provocar uno real (por ejemplo desconectar la red a mitad de
   una operación si el manejo de errores no está exhaustivo) y confirmar que
   aparece en el proyecto de Sentry del frontend. `frontend/src/main.tsx` ya
   inicializa `@sentry/browser` con `Sentry.init({ dsn, ... })` si
   `VITE_SENTRY_DSN` está presente — si no aparece nada, lo primero a
   revisar es que la variable esté cargada en el build (`VITE_` es
   build-time, no runtime: si se cambia `.env.local` hay que volver a
   `npm run build`).
4. `logError` (`backend/02_util.js`) — endpoint de log explícito del
   frontend para errores que sí se capturan pero se quiere dejar constancia
   igual:

   ```bash
   curl -s -X POST "${WEBAPP_URL}?action=logError&token=${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"mensaje":"prueba manual de logError"}'
   ```

   Debe responder `{"success":true,...}` y dejar una fila nueva en
   `Notificaciones`.

- [ ] Verificado: errores del backend llegan a `Notificaciones` y a Sentry.
- [ ] Verificado: errores del frontend llegan a Sentry.

---

## 5. Pruebas del backend (Jest sobre la lógica pura)

**Qué se comprueba:** la lógica pura (cálculo de balances, validación de
montos, cálculo de progreso de presupuesto) está separada de
`SpreadsheetApp` y tiene test.

**Cómo comprobarlo:**

```bash
npm test              # corre todo tests/**/*.test.js
npm run test:coverage # igual, con reporte de cobertura sobre backend/lib_*.js
```

**Estado verificado por este agente** (con el backend ya escrito por el
agente de backend, `backend/lib_validacion.js`, `backend/lib_calculos.js`,
`backend/lib_sync.js`):

- `npm test` → **150 tests en verde + 18 pendientes de activación (skip
  agraciado, no falla)**, 8 suites: `lib_validacion`, `lib_calculos`,
  `lib_sync`, `pago_deuda_y_op_id`, `sync_escenario_offline`
  (conflicto de sincronización), y las tres nuevas del cambio a dos espacios
  — `aislamiento_espacios` (7/7 en verde), `obligaciones_mensuales` (3/3 en
  verde + 12 en espera) y `solicitudes_dinero` (0/6, toda en espera).
- `npm run test:coverage` → sobre `backend/lib_*.js` existentes
  (`lib_validacion.js`, `lib_calculos.js`, `lib_sync.js`); supera los
  umbrales configurados en `jest.config.js` (90/80/90/90 por archivo). El
  glob `collectCoverageFrom: ['backend/lib_*.js']` recoge automáticamente
  cualquier `lib_*.js` nuevo (por ejemplo `lib_obligaciones.js` o
  `lib_solicitudes.js`, ver más abajo) sin tocar `jest.config.js`.
- **Los 18 tests en espera no son un hueco de cobertura silencioso**: cada
  uno documenta en su cabecera la firma de función pura recomendada
  (`resolverFechaVencimientoMensual` en `lib_calculos.js`,
  `debeGenerarPeriodo`/`periodoActual` en un `lib_obligaciones.js` nuevo,
  `puedeResponderSolicitud`/`resolverRespuestaSolicitud` en un
  `lib_solicitudes.js` nuevo) y se activan solos, sin editar el test, en
  cuanto el agente de backend agregue esos archivos/funciones — ver § 8-10
  más abajo y `tests/obligaciones_mensuales.test.js` /
  `tests/solicitudes_dinero.test.js`.
- En el proceso de escribir los tests originales contra el contrato (sin
  mirar la implementación de antemano) se encontraron y el agente de backend
  corrigió en el momento tres bugs reales, los tres relevantes para el
  objetivo central de este proyecto (README § 14, "no repetir los `#NUM!`"):
  1. `validarFecha` aceptaba fechas de calendario imposibles (`2026-02-30`,
     `2025-02-29` en año no bisiesto, mes/día `00`/`13`) porque
     `new Date(anio, mes-1, dia)` de JS "rueda" la fecha al mes siguiente en
     vez de fallar — quedó corregido comparando los componentes de la fecha
     resultante contra los originales. **El mismo bug de raíz** es el que
     ahora hay que evitar en `resolverFechaVencimientoMensual` (§ 10):
     `new Date(anio, 1, 31)` da marzo en silencio, ver el bloque siempre-verde
     en `tests/obligaciones_mensuales.test.js`.
  2. `validarMonto` aceptaba un array de un solo elemento (`[45.9]`) como
     monto válido, porque `String([45.9])` da `'45.9'` — type confusion.
     Corregido validando `typeof valor` antes de convertir a texto.
  3. `diasHastaVencimiento` (y por extensión cualquier fecha `'yyyy-MM-dd'`
     parseada con `new Date(string)`) quedaba desfasada en **un día completo**
     en cualquier huso horario detrás de UTC — incluido `America/Lima`
     (`appsscript.json`), el huso real del proyecto. Corregido parseando la
     fecha como componentes locales en vez de dejar que el motor de JS la
     interprete como medianoche UTC.
- No se relajó ningún test para "hacerlo pasar": los tres bugs se
  encontraron porque el test escrito contra el contrato falló primero, y el
  código se corrigió para cumplirlo — no al revés.

- [x] `npm test` corre limpio (150 en verde, 18 en espera documentada — 0 en rojo).
- [x] Cobertura sobre `backend/lib_*.js` por encima de los umbrales.

---

## 6. Prueba de conflicto de sincronización

**Qué se comprueba:** simular dos ediciones offline del mismo registro desde
dos dispositivos y confirmar que el sistema muestra el conflicto en vez de
perder una de las dos.

### 6.1 Automático — a nivel de lógica pura

`tests/sync_escenario_offline.test.js` simula exactamente este escenario
contra `resolverOperacion` (`backend/lib_sync.js`): dos dispositivos
descargan la misma fila en `rev=1`, cada uno edita un campo distinto offline,
el dispositivo A sincroniza primero (`aplicado`, `rev` sube a 2) y el
dispositivo B sincroniza después todavía con `rev_base=1` (`conflicto`, con
`version_servidor` y `version_cliente` completas, sin sobrescribir lo que
dejó A). Corre como parte de `npm test` — ver estado en la sección 5.

### 6.2 Manual — end to end, contra la sesión offline real de la PWA

Esto prueba la cadena completa: `frontend/src/offline/sync.ts` +
`frontend/src/screens/Conflictos.tsx` + el endpoint real `sincronizar`
(`backend/30_sincronizar.js`), no solo la función pura.

1. Instalar la PWA en **dos dispositivos o dos navegadores distintos**
   (por ejemplo Chrome normal y Chrome en modo incógnito, o dos perfiles),
   ambos logueados con **el mismo usuario** (o dos usuarios del mismo
   espacio compartido — el conflicto es por registro, no por usuario).
2. En ambos, abrir la misma transacción existente y confirmar que muestran
   el mismo valor de partida.
3. Cortar la conexión de red en **ambos** dispositivos (DevTools → Network →
   Offline, o modo avión si es un celular real).
4. En el dispositivo A, editar la transacción (por ejemplo cambiar el monto).
   Debe guardarse localmente (Dexie) y quedar marcada como pendiente de
   sincronizar — confirmar el indicador de "pendientes" que expone
   `useEstadoSync()`.
5. En el dispositivo B, sin haber recibido el cambio de A (sigue offline),
   editar la **misma** transacción con un cambio distinto (por ejemplo la
   descripción o la categoría).
6. Reconectar el dispositivo A primero y dejar que sincronice
   (`sincronizarAhora()` o automático). Confirmar que su cambio quedó
   aplicado (consultando el spreadsheet o `getTransaccion` directo).
7. Reconectar el dispositivo B. Su sincronización debe:
   - **No perder** la edición local de B (sigue en su Dexie con
     `sync_status: conflict`, no se descarta).
   - **No sobrescribir** lo que aplicó A en el servidor.
   - Mostrar el conflicto en `Conflictos.tsx` con ambas versiones lado a
     lado (la del servidor, que ya tiene el cambio de A, y la local de B)
     para que la persona elija.
8. Resolver el conflicto desde la UI y confirmar que después de resolverlo
   ambos dispositivos terminan viendo el mismo estado final (el que se
   eligió), y que no quedó ningún dato de ninguno de los dos lados perdido
   sin mostrarse en algún momento del proceso.

- [ ] Verificado el flujo manual end-to-end con dos dispositivos/sesiones reales.

---

## 7. Revisión de diseño

**Qué se comprueba:** cada pantalla nueva se compara contra los tokens de
README § 8 / CONTRACT § 6 antes de darla por terminada; ninguna pantalla usa
colores o tipografía fuera de esa lista.

**Tokens permitidos** (`frontend/src/design/tokens.css`):
`--bg`, `--surface`, `--text`, `--text-secondary`, `--accent`, `--expense`,
`--income`, `--separator`, más variantes de opacidad de esos mismos colores.
Tipografía: `system-ui, -apple-system, 'Segoe UI', Inter, sans-serif`.
Montos con `font-variant-numeric: tabular-nums`. Los colores de categoría
(`Categoria.color`, que vienen de datos en Sheets) no cuentan como "colores
nuevos" — son contenido, no parte del sistema de diseño.

**Cómo comprobarlo:**

1. Búsqueda de colores hardcodeados fuera de `tokens.css` en los CSS del
   frontend:

   ```bash
   grep -rnoE "#[0-9a-fA-F]{3,8}\b" frontend/src --include='*.css' \
     | grep -v 'frontend/src/design/tokens.css'
   ```

   Cualquier resultado hay que revisarlo a mano: es aceptable si es un valor
   dentro de una función `rgba()`/`color-mix()` derivada de un token (por
   ejemplo un `#fff` de `box-shadow` con opacidad), pero **no** si introduce
   un color nuevo fuera de la paleta.
2. Confirmar que ningún componente importa una librería de UI genérica:

   ```bash
   grep -rniE "@mui|semantic-ui|bootstrap|shadcn|antd" frontend/package.json frontend/src --include='*.tsx' --include='*.ts' --include='*.json'
   ```

   No debería devolver nada (`frontend/package.json` solo declara `react`,
   `recharts`, `dexie`, `@sentry/browser` como dependencias de UI/datos —
   sin librería de componentes).
3. Confirmar que no hay menú hamburguesa ni sidebar: revisar
   `frontend/src/components/TabBar.tsx` (debe ser la única navegación,
   fija abajo, con Resumen/Gastos/Deudas + Administración solo si
   `mostrarAdmin`).
4. Confirmar visualmente (con la app corriendo) que:
   - Hay una única tarjeta con vidrio esmerilado (`backdrop-filter: blur`):
     la tarjeta hero de saldo del mes (`TarjetaHero.tsx`/`.css`).
   - Los anillos de progreso por categoría son SVG propio
     (`AnilloProgreso.tsx`), no un componente de una librería de gráficos.
   - Los montos alinean verticalmente entre sí (`tabular-nums`) en listas
     largas (`Gastos.tsx`).
   - El modo oscuro (`prefers-color-scheme: dark` del sistema operativo)
     respeta los mismos roles de color, no una paleta distinta.

- [ ] Verificado: sin colores fuera de la paleta.
- [ ] Verificado: sin librerías de UI genéricas, sin hamburguesa/sidebar.
- [ ] Verificado visualmente en claro y oscuro.

---

## 8. Aislamiento entre espacios

**Qué se comprueba:** la razón de ser del cambio a dos espacios
(`docs/CONTRACT.md` § 0.3): un miembro no puede leer ni escribir data de un
espacio del que no es miembro activo (`NO_ES_MIEMBRO`), y ningún endpoint que
lista o agrega datos (`getDashboard`, `getResumenMensual`, `getTendencia`,
`getTopCategorias`, `sincronizar`, etc.) mezcla registros de `ESP_FAMILIA` con
los de `ESP_TELCOM`. "Ni siquiera agregada" (§ 3): un total no puede filtrarse
a través aunque el detalle esté oculto.

**Cómo comprobarlo:**

1. Automático — a nivel de lógica pura: `tests/aislamiento_espacios.test.js`
   (parte de `npm test`, 7/7 en verde). Fija el patrón correcto — filtrar por
   `id_espacio` **antes** de llamar a `calcularBalance` /
   `calcularResumenMensual` / `agruparPorCategoria` (`backend/lib_calculos.js`)
   — y prueba que con ese patrón un mes con mucho gasto de Telcom nunca infla
   el balance de Familia ni viceversa, incluida la proporción de
   `agruparPorCategoria` (que se recalcula solo contra el total del espacio
   filtrado, no contra el total mezclado).
2. Manual contra el backend real:
   - Con un usuario de prueba, quitarle la membresía activa de `ESP_TELCOM`
     a mano en `MiembrosEspacio` (`activo = false` en esa fila, dejando la de
     `ESP_FAMILIA` intacta — por defecto `inicializarSistema()` hace miembro
     de ambos a todo usuario activo).
   - Con la sesión de ese usuario, pedir cualquier acción GET con
     `id_espacio=ESP_TELCOM` (`getTransacciones`, `getCuentas`,
     `getDashboard`, ...): debe responder `NO_ES_MIEMBRO`, no datos parciales
     ni vacíos silenciosos.
   - Con un usuario que sí es miembro de los dos: comparar a mano
     `getResumenMensual` de `ESP_FAMILIA` contra la suma real de
     `Transacciones` filtradas por `id_espacio=ESP_FAMILIA` en el
     spreadsheet — no debe incluir ningún monto cuya fila real tenga
     `id_espacio=ESP_TELCOM`, y viceversa.
3. Manual visual (frontend): con el selector `Familia | Telcom` (`docs/CONTRACT.md`
   § 6), cambiar de espacio y confirmar que **todo** lo que se ve en pantalla
   cambia junto (saldo hero, listado de gastos, deudas, categorías) — nunca un
   número se actualiza y otro queda pegado del espacio anterior.

**Dónde vive en el código:** el filtro `.filter(x => x.id_espacio === idEsp)`
está repetido dominio por dominio (`backend/12_cuentas.js`, `13_categorias.js`,
`14_transacciones.js`, `16_deudas.js`, `18_presupuestos.js`, `19_recurrentes.js`,
`20_etiquetas.js`, `22_dashboard.js`) — **no hay todavía** una función pura
única que lo centralice y sea testeable sin `SpreadsheetApp`. Se recomienda
extraer un `filtrarPorEspacio(filas, idEspacio)` común a `backend/lib_calculos.js`
(o un `lib_espacios.js` nuevo) para poder testear ese filtro en sí, no solo el
patrón de uso correcto (que es lo único que `tests/aislamiento_espacios.test.js`
puede probar hoy). El guardián `NO_ES_MIEMBRO` a nivel de sesión es responsabilidad
del agente de backend (router/auth, § 3 del contrato) y no tiene lógica pura
identificada todavía para testear en Jest.

- [ ] Automático verificado (`tests/aislamiento_espacios.test.js`, parte de `npm test`).
- [ ] Verificado manualmente: `NO_ES_MIEMBRO` cuando corresponde.
- [ ] Verificado manualmente: ningún total agregado de un espacio incluye montos del otro.
- [ ] Verificado visualmente: cambiar de espacio en el frontend actualiza todo junto.

---

## 9. Solicitudes de dinero: no se puede aprobar/rechazar dos veces

**Qué se comprueba** (`docs/CONTRACT.md` § 4-bis): `responderSolicitud` sobre
una solicitud que ya salió de `estado='solicitada'` devuelve
`SOLICITUD_YA_RESPONDIDA` sin tocar nada; aprobar crea la transacción de gasto
de una vez (`id_transaccion` queda seteado), rechazar no crea ninguna.

**Cómo comprobarlo:**

1. Automático: `tests/solicitudes_dinero.test.js` — la cobertura está escrita
   y lista (guardián de estado, aprobar-crea-transacción, rechazar-no-crea,
   simulación de doble click) pero **hoy se salta completa**: depende de un
   `backend/lib_solicitudes.js` que todavía no existe (ver la firma
   recomendada en la cabecera del archivo de test). Confirmar con `npm test`
   que el warning `[tests/solicitudes_dinero.test.js] backend/lib_solicitudes.js
   todavía no existe` **ya no aparece** — eso indica que el agente de backend
   extrajo la lógica pura y los 6 tests pasaron a correr de verdad.
2. Manual contra el backend real:
   - `crearSolicitud` de prueba (monto, motivo, categoría, espacio).
   - `responderSolicitud` con `aprobar=true`: confirmar en `Transacciones`
     que apareció una fila nueva `tipo='gasto'`, y en `SolicitudesDinero` que
     `estado='aprobada'` y `id_transaccion` apunta a ella.
   - Repetir el **mismo** `responderSolicitud` (mismo `id_solicitud`): debe
     responder `SOLICITUD_YA_RESPONDIDA` y **no** debe aparecer una segunda
     fila en `Transacciones` (contar filas antes y después).
   - Con una solicitud nueva, `responderSolicitud` con `aprobar=false`:
     confirmar `estado='rechazada'` y que **no** se creó ninguna fila en
     `Transacciones`.
   - Simular el doble click real de Telegram: mandar dos `responderSolicitud`
     **en paralelo** (mismo patrón que § 2 de Concurrencia, `curl ... & curl
     ... & wait`) contra la misma solicitud recién creada. Como mucho una de
     las dos debe quedar `aplicado`/crear transacción; la otra debe salir con
     `SOLICITUD_YA_RESPONDIDA` — nunca dos transacciones.

**Dónde vive en el código:** `backend/23_solicitudes.js` (`responderSolicitud`,
`crearSolicitud`), estado en `SolicitudesDinero.estado`.

- [ ] Automático verificado (o pendiente: `backend/lib_solicitudes.js` no existe todavía).
- [ ] Verificado manualmente: aprobar crea transacción, rechazar no crea ninguna.
- [ ] Verificado manualmente: segundo `responderSolicitud` → `SOLICITUD_YA_RESPONDIDA`, sin transacción duplicada.
- [ ] Verificado con dos respuestas en paralelo (doble click) que no se duplica la transacción.

---

## 10. Obligaciones mensuales: idempotencia y fin de mes corto

**Qué se comprueba** (`docs/CONTRACT.md` § 4-ter): `generarObligacionesDelMes`
corrida varias veces el mismo mes genera **una sola** `Deuda` por obligación
activa (idempotencia por `ultimo_periodo_generado`); y una obligación con
`dia_vencimiento` 29, 30 o 31 en un mes que no llega a ese día cae en el
**último día real** de ese mes — nunca en el 1-3 del mes siguiente, que es lo
que produce en silencio `new Date(anio, mes-1, dia)` de JS con un día que no
existe en ese mes.

**Cómo comprobarlo:**

1. Automático: `tests/obligaciones_mensuales.test.js`:
   - El bloque "bug clásico de JS Date" corre **siempre** (no depende de
     ningún archivo del proyecto) y deja documentado en la suite, con
     aserciones reales, por qué `new Date(anio, 1, 31)` no sirve como
     implementación (da marzo, no el 28/29 de febrero clampeado).
   - El resto — `resolverFechaVencimientoMensual` (clamp de fin de mes,
     probado explícitamente en febrero 2026 no bisiesto, febrero 2024
     bisiesto y febrero 2025 no bisiesto) y `debeGenerarPeriodo`/
     `periodoActual` con la simulación de "correr el trigger diez veces el
     mismo día" — está escrito y listo pero se salta hasta que existan
     `backend/lib_calculos.js:resolverFechaVencimientoMensual` y un
     `backend/lib_obligaciones.js` nuevo (firmas recomendadas en la cabecera
     del archivo de test). Confirmar con `npm test` que esos warnings dejan
     de aparecer.
2. Manual contra el backend real:
   - `crearObligacion` de prueba con `dia_vencimiento=31`.
   - Correr `generarObligacionesDelMes()` a mano **diez veces seguidas** el
     mismo día (desde el editor de Apps Script). Confirmar en `Deudas` que
     apareció **exactamente una** fila nueva, y en `ObligacionesMensuales`
     que `ultimo_periodo_generado` quedó en el mes en curso (`'yyyy-MM'`).
   - Repetir específicamente en un mes corto (28/29/30 días) — o adelantar
     temporalmente `dia_vencimiento=31` sobre una obligación de prueba y
     correr el trigger durante febrero real, o el mes de prueba más próximo
     de 30 días — y confirmar que `fecha_vencimiento` de la `Deuda` generada
     es el **último día real** de ese mes (`2026-02-28`, `2026-04-30`, ...),
     nunca el 1-3 del mes siguiente.
   - Caso año bisiesto: en febrero de un año bisiesto (el próximo es 2028)
     con `dia_vencimiento=29`, confirmar que el vencimiento generado **es**
     el 29 (no se clampea de más a 28 cuando el día sí existe ese año).

**Dónde vive en el código:** `backend/24_obligaciones.js`
(`generarObligacionesDelMes`), campo `ObligacionesMensuales.ultimo_periodo_generado`;
el trigger diario que la invoca se configura en `docs/SETUP.md` § 11.

- [ ] Automático verificado (bloque "bug clásico" siempre en verde; el resto activado cuando exista la lógica pura).
- [ ] Verificado manualmente: diez corridas el mismo día → una sola deuda generada.
- [ ] Verificado manualmente: día 29/30/31 en mes corto cae en el último día real del mes.
- [ ] Verificado en un año bisiesto que el 29 de febrero no se clampea de más.

---

## Resumen de estado

| Sección | Estado |
|---|---|
| 1. Validación de datos | Pendiente de verificar contra backend desplegado |
| 2. Concurrencia | Pendiente de verificar contra backend desplegado |
| 3. Seguridad | Pendiente de verificar contra backend desplegado |
| 4. Monitoreo | Pendiente de verificar contra backend + Sentry reales |
| 5. Tests de Jest | **Verificado — 150 en verde + 18 en espera documentada (0 en rojo)** |
| 6. Prueba de conflicto de sync | Automático verificado (§ 6.1); manual end-to-end pendiente |
| 7. Revisión de diseño | Pendiente de verificar visualmente con la app corriendo |
| 8. Aislamiento entre espacios | Automático verificado (§ 8, lógica pura); manual/visual pendiente de backend desplegado |
| 9. Solicitudes: no-doble-respuesta | Pendiente: cobertura automática escrita pero en espera de `lib_solicitudes.js`; manual pendiente de backend desplegado |
| 10. Obligaciones: idempotencia y fin de mes | Parcial: bug clásico de `Date` verificado siempre; resto en espera de `lib_calculos.resolverFechaVencimientoMensual`/`lib_obligaciones.js`; manual pendiente de backend desplegado |

La sección 5 (y las partes automáticas de 6, 8 y 10) son las únicas que este
agente pudo ejecutar de punta a punta sin un backend desplegado. El resto
requiere haber completado `docs/SETUP.md` contra un deployment real — quien
lo despliegue debe recorrer este documento y marcar cada casilla. Las
secciones 9 y 10 en particular no van a poder verificarse del todo hasta que
el agente de backend agregue `backend/lib_solicitudes.js` y
`backend/lib_calculos.js:resolverFechaVencimientoMensual` /
`backend/lib_obligaciones.js` — ver la nota en la sección 5 y las cabeceras
de `tests/solicitudes_dinero.test.js` / `tests/obligaciones_mensuales.test.js`.
