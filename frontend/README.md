# Chanchito — Frontend

PWA (Vite + React + TypeScript) con capa offline (Dexie) y sincronización con control de
revisiones contra el backend de Apps Script. Ver `docs/CONTRACT.md` para el contrato completo.

## Desarrollo local

```bash
cd frontend
npm install
cp .env.example .env.local   # completar VITE_API_URL, VITE_SHARED_TOKEN, VITE_GOOGLE_CLIENT_ID
npm run dev
```

Abre en `http://localhost:5173/CHANCHITO/` (el `base: '/CHANCHITO/'` de `vite.config.ts` aplica
también en dev). El service worker de PWA está desactivado en `dev` (comportamiento por defecto
de `vite-plugin-pwa`); para probar el modo offline hace falta un build.

## Build

```bash
npm run build      # tsc -b && vite build → frontend/dist
npm run preview    # sirve dist/ localmente para probar el service worker
```

`npm run typecheck` corre solo `tsc -b --noEmit`, sin build, útil en CI rápido.

## Estructura de la capa de datos

- `src/data/types.ts` — tipos compartidos (espejo de las columnas de Sheets).
- `src/data/api.ts` — **única** interfaz que la UI puede importar. Hooks de lectura reactiva
  (`useTransacciones`, `useResumenMensual`, ...) y funciones de escritura optimista
  (`crearTransaccion`, `editarTransaccion`, ...).
- `src/data/cliente.ts` — llamadas HTTP crudas al Web App de Apps Script.
- `src/offline/db.ts` — esquema de Dexie (IndexedDB).
- `src/offline/cola.ts` — cola FIFO de operaciones pendientes de sincronizar.
- `src/offline/sync.ts` — motor de sincronización: dispara, reintenta con backoff, mergea
  los cambios del servidor y arma los conflictos.
- `src/offline/sesion.ts` — sesión persistida + patrón observable (`onSesionChange`).
- `src/screens/Conflictos.tsx` — UI de resolución de conflictos de sincronización.

La UI (`src/screens/{Resumen,Gastos,Deudas,Admin,Login}.tsx`, `src/components/**`) nunca importa
nada de `offline/` ni `data/cliente.ts` directamente: todo pasa por `data/api.ts`. Así la UI no
necesita saber si hay conexión o no.

## Desplegar a GitHub Pages

El workflow `.github/workflows/deploy.yml` builda y publica `frontend/dist` en cada push a
`main` que toque `frontend/**`. Antes de que corra hace falta:

1. En **Settings → Pages** del repo, poner el origen en "GitHub Actions".
2. En **Settings → Secrets and variables → Actions**, cargar como *repository secrets*:
   `VITE_API_URL`, `VITE_SHARED_TOKEN`, `VITE_GOOGLE_CLIENT_ID`, `VITE_SENTRY_DSN` — los mismos
   valores que en `.env.local`, nunca committeados.

Para desplegar a mano sin esperar al push: `Actions → Deploy frontend a GitHub Pages → Run workflow`.

Una vez publicado queda en `https://<usuario-o-org>.github.io/CHANCHITO/`, consistente con el
`base: '/CHANCHITO/'` de `vite.config.ts`.

## Notas de la capa offline

- **Escritura optimista**: crear/editar/eliminar escribe primero en Dexie (`sync_status:
  'pending'`) y encola la operación; la UI se entera al instante vía `useLiveQuery`, con o sin
  conexión. El id de las entidades nuevas (`TRX_xxxxxxxx`, `DDA_xxxxxxxx`) lo genera el cliente
  con el mismo formato que `backend/02_util.js#generateId`.
- **Control de revisiones**: cada edición manda `rev_base` = el `rev` que tenía el registro al
  empezar a editar. Si el servidor ve que ya no coincide, no sobrescribe: guarda un conflicto con
  las dos versiones para que la persona elija en `Conflictos.tsx`.
- **Merge de `cambios`**: lo que trae el servidor pisa lo local, salvo que el registro local esté
  en `pending` o `conflict` — eso nunca se pisa en silencio.
- **Una sola sincronización a la vez**: hay un mutex en memoria; si ya hay una en vuelo, una
  segunda invocación se descarta (la próxima corrida por intervalo/reconexión/manual ya manda lo
  que quedó pendiente).

## Puntos donde el contrato no especifica (ver comentarios `TODO(contrato):` en el código)

- `FiltroGastos`, `NuevaTransaccion`, `NuevaDeuda`: sus campos no están en `CONTRACT.md`, se
  eligieron según lo que la UI necesita razonablemente.
- `registrarPagoDeuda`: el endpoint `sincronizar` (CONTRACT § 4) solo define operaciones
  `crear`/`editar`/`eliminar` sobre `transaccion`/`deuda`/`presupuesto`. No hay forma de
  representar offline un pago (que en el backend además crea una fila en `PagosDeuda`). Se
  modela como una edición de `monto_pendiente`/`estado` sobre la deuda.
- `crearUsuario`/`desactivarUsuario`: `usuario` no es una entidad sincronizable en CONTRACT § 4,
  así que estas acciones requieren conexión y no pasan por la cola offline.
