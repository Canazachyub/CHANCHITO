/**
 * Motor de sincronización (CONTRACT § 4, README § 6).
 *
 * Se dispara: al recuperar conexión (`online`), al arrancar la app (`iniciarMotorSync`),
 * cada `INTERVALO_MS`, y a mano vía `sincronizarAhora()`. Nunca hay dos sincronizaciones
 * concurrentes: el flag `sincronizando` hace que una segunda invocación mientras la primera
 * sigue en vuelo se descarte sin más (la próxima corrida — por intervalo, por 'online' o manual —
 * ya va a mandar lo que quedó pendiente, así que no hace falta encolarla).
 */
import type { Table } from 'dexie';
import { db, ahora, getEspacioActivoId, ESP_FAMILIA, ESP_TELCOM, type OperacionCola } from './db';
import { listarCola, quitarDeCola, encolar } from './cola';
import {
  sincronizar as sincronizarHttp,
  getEspaciosRemoto,
  getObligacionesRemoto,
  getSolicitudesRemoto,
  type CambiosServidor,
  type ResultadoOperacion,
} from '../data/cliente';
import { getSesion } from './sesion';
import type { Conflicto, Deuda, Presupuesto, SyncStatus, Transaccion } from '../data/types';

const INTERVALO_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
/**
 * `servidor_ts` por espacio. La clave vieja `'servidor_ts'` (un solo marcador global) queda
 * deliberadamente sin usar: al no encontrarla, la primera sincronización de cada espacio
 * arranca con `desde = null` y el servidor devuelve todo, que es exactamente lo que hace
 * falta para no dejar huecos al pasar del modelo de un espacio al de dos.
 */
function claveServidorTs(idEspacio: string): string {
  return 'servidor_ts:' + idEspacio;
}

const ESPACIOS = [ESP_FAMILIA, ESP_TELCOM] as const;

let sincronizando = false;
let fallosConsecutivos = 0;
let timerReintento: ReturnType<typeof setTimeout> | null = null;
let inicializado = false;

type Suscriptor = () => void;
const suscriptoresEstado = new Set<Suscriptor>();
function notificarEstado(): void {
  for (const cb of suscriptoresEstado) cb();
}

/** Para useEstadoSync(): se suscribe a cambios de `sincronizandoAhora()`. */
export function onEstadoSyncChange(cb: Suscriptor): () => void {
  suscriptoresEstado.add(cb);
  return () => {
    suscriptoresEstado.delete(cb);
  };
}

export function sincronizandoAhora(): boolean {
  return sincronizando;
}

/** Se llama una sola vez al arrancar la app (ver data/api.ts). Idempotente. */
export function iniciarMotorSync(): void {
  if (inicializado) return;
  inicializado = true;
  window.addEventListener('online', () => {
    void sincronizarAhora();
  });
  setInterval(() => {
    void sincronizarAhora();
  }, INTERVALO_MS);
  void sincronizarAhora();
}

export async function sincronizarAhora(): Promise<void> {
  if (sincronizando) return;
  if (!navigator.onLine) return;
  const sesion = await getSesion();
  if (!sesion) return;

  sincronizando = true;
  notificarEstado();
  try {
    // Un lote por espacio (CONTRACT § 4): el endpoint acota `cambios` al `id_espacio` que
    // recibe, así que mandar la cola entera de una vez dejaría al otro libro sin sus cambios.
    // Cada espacio lleva SU PROPIO `servidor_ts`: con un marcador compartido, sincronizar
    // Familia lo adelantaría y Telcom se perdería para siempre todo lo ocurrido en el medio.
    const colaCompleta = await listarCola();

    for (const idEspacio of ESPACIOS) {
      const claveTs = claveServidorTs(idEspacio);
      const desde = (await db.meta.get(claveTs))?.valor ?? null;
      const colaEnviada = colaCompleta.filter((op) => op.id_espacio === idEspacio);
      const operaciones = colaEnviada.map((op) => ({
        op_id: op.op_id,
        tipo: op.tipo,
        entidad: op.entidad,
        id: op.id,
        rev_base: op.rev_base,
        datos: op.datos,
      }));

      const respuesta = await sincronizarHttp(idEspacio, desde, operaciones);

      await procesarResultados(respuesta.resultados, colaEnviada);
      await mergeCambios(respuesta.cambios, idEspacio);
      await db.meta.put({ clave: claveTs, valor: respuesta.servidor_ts });
    }

    await refrescarEspacios();
    await refrescarSolicitudesYObligaciones();

    fallosConsecutivos = 0;
    if (timerReintento) {
      clearTimeout(timerReintento);
      timerReintento = null;
    }
  } catch {
    // Error de red o del servidor (LOCK_TIMEOUT, ERROR_INTERNO, etc.): no se pierde la cola,
    // se reintenta con backoff exponencial acotado. Los rechazos puntuales por operación
    // (MONTO_INVALIDO, etc.) NO caen acá: esos vienen en `resultados` con estado 'rechazado'
    // y se resuelven op por op en procesarResultados sin afectar el resto del lote.
    fallosConsecutivos++;
    const espera = Math.min(BACKOFF_BASE_MS * 2 ** (fallosConsecutivos - 1), BACKOFF_MAX_MS);
    if (timerReintento) clearTimeout(timerReintento);
    timerReintento = setTimeout(() => {
      void sincronizarAhora();
    }, espera);
  } finally {
    sincronizando = false;
    notificarEstado();
  }
}

/** Las tres entidades que sí tienen tabla propia en Dexie (pago_deuda no: ver EntidadSincronizable). */
type EntidadConTabla = 'transaccion' | 'deuda' | 'presupuesto';

async function marcarEstado(
  entidad: EntidadConTabla,
  id: string,
  cambios: { rev?: number; sync_status: SyncStatus; rev_base?: undefined },
): Promise<void> {
  switch (entidad) {
    case 'transaccion':
      await db.transacciones.update(id, cambios);
      return;
    case 'deuda':
      await db.deudas.update(id, cambios);
      return;
    case 'presupuesto':
      await db.presupuestos.update(id, cambios);
      return;
  }
}

async function obtenerFilaLocal(entidad: EntidadConTabla, id: string): Promise<{ rev: number; id_espacio: string } | undefined> {
  switch (entidad) {
    case 'transaccion':
      return db.transacciones.get(id);
    case 'deuda':
      return db.deudas.get(id);
    case 'presupuesto':
      return db.presupuestos.get(id);
  }
}

async function procesarResultados(resultados: ResultadoOperacion[], colaEnviada: OperacionCola[]): Promise<void> {
  const porOpId = new Map(colaEnviada.map((op) => [op.op_id, op]));

  for (const resultado of resultados) {
    const opOriginal = porOpId.get(resultado.op_id);
    if (!opOriginal) continue;
    await quitarDeCola(resultado.op_id);

    if (opOriginal.entidad === 'pago_deuda') {
      await procesarResultadoPagoDeuda(resultado, opOriginal);
      continue;
    }

    if (resultado.estado === 'aplicado') {
      await marcarEstado(opOriginal.entidad, opOriginal.id, {
        rev: resultado.rev,
        sync_status: 'synced',
        rev_base: undefined,
      });
      continue;
    }

    if (resultado.estado === 'conflicto') {
      const conflicto: Conflicto = {
        id_conflicto: crypto.randomUUID(),
        entidad: opOriginal.entidad,
        id_registro: opOriginal.id,
        estado: 'conflicto',
        version_cliente: resultado.version_cliente ?? opOriginal.datos,
        version_servidor: resultado.version_servidor ?? {},
        fecha_detectado: ahora(),
      };
      await db.conflictos.put(conflicto);
      await marcarEstado(opOriginal.entidad, opOriginal.id, { sync_status: 'conflict' });
      continue;
    }

    // 'rechazado': sale de la cola para siempre (no se reintenta en bucle) y el registro local
    // pasa a sync_status='rechazado' — un estado propio, no una reutilización de 'conflict' —
    // para que Conflictos.tsx pueda distinguir ambos casos sin inspeccionar campos escondidos.
    const conflicto: Conflicto = {
      id_conflicto: crypto.randomUUID(),
      entidad: opOriginal.entidad,
      id_registro: opOriginal.id,
      estado: 'rechazado',
      version_cliente: opOriginal.datos,
      version_servidor: {},
      error: resultado.error ?? 'ERROR_INTERNO',
      detalle: resultado.detalle ?? '',
      fecha_detectado: ahora(),
    };
    await db.conflictos.put(conflicto);
    await marcarEstado(opOriginal.entidad, opOriginal.id, { sync_status: 'rechazado' });
  }
}

/**
 * Resultado de una operación 'pago_deuda' (CONTRACT § 4, "Entidad pago_deuda"). No tiene tabla
 * propia: todo se resuelve sobre la DEUDA que el pago afecta (`datos.id_deuda`), igual que hace
 * data/api.ts registrarPagoDeuda() al aplicarla de forma optimista.
 */
async function procesarResultadoPagoDeuda(resultado: ResultadoOperacion, opOriginal: OperacionCola): Promise<void> {
  const idDeuda = String(opOriginal.datos['id_deuda'] ?? '');
  if (!idDeuda) return;

  if (resultado.estado === 'aplicado') {
    // Decisión propia: CONTRACT § 4 dice que el servidor "devuelve la deuda actualizada en
    // resultados" para 'pago_deuda' pero no nombra el campo. Se reutiliza `version_servidor`
    // porque ya tiene exactamente esa semántica ("fila completa actual") para 'conflicto'.
    const deudaServidor = resultado.version_servidor;
    if (deudaServidor && Object.keys(deudaServidor).length > 0) {
      await db.deudas.put({ ...(deudaServidor as unknown as Deuda), sync_status: 'synced' });
    } else {
      await db.deudas.update(idDeuda, { sync_status: 'synced' });
    }
    return;
  }

  if (resultado.estado === 'conflicto') {
    // "Se maneja igual que los demás" (CONTRACT § 4): se muestra como un conflicto normal de
    // 'deuda', reutilizando la misma tarjeta de Conflictos.tsx en vez de inventar una específica
    // para pagos. version_cliente es el estado optimista que ya tenía la deuda localmente.
    const local = await db.deudas.get(idDeuda);
    const conflicto: Conflicto = {
      id_conflicto: crypto.randomUUID(),
      entidad: 'deuda',
      id_registro: idDeuda,
      estado: 'conflicto',
      version_cliente: local ? { ...local } : opOriginal.datos,
      version_servidor: resultado.version_servidor ?? {},
      fecha_detectado: ahora(),
    };
    await db.conflictos.put(conflicto);
    await marcarEstado('deuda', idDeuda, { sync_status: 'conflict' });
    return;
  }

  // 'rechazado': el pago nunca se aplicó (ej. monto mayor al pendiente). La deuda local ya había
  // bajado monto_pendiente de forma optimista; no hay snapshot previo para revertir a ciegas
  // (misma limitación que ya tenían los rechazos de edición antes de este cambio), así que se
  // deja en manos del usuario vía Conflictos.tsx (Corregir / Descartar).
  const conflicto: Conflicto = {
    id_conflicto: crypto.randomUUID(),
    entidad: 'deuda',
    id_registro: idDeuda,
    estado: 'rechazado',
    version_cliente: opOriginal.datos,
    version_servidor: {},
    error: resultado.error ?? 'ERROR_INTERNO',
    detalle: resultado.detalle ?? '',
    fecha_detectado: ahora(),
  };
  await db.conflictos.put(conflicto);
  await marcarEstado('deuda', idDeuda, { sync_status: 'rechazado' });
}

/**
 * Regla de merge (README § 6): lo que manda el servidor pisa lo local con sync_status='synced',
 * PERO nunca pisa un registro en 'pending' o 'conflict'. Pisarlo sería perder en silencio una
 * edición offline todavía no confirmada, o una resolución de conflicto que el usuario ya decidió
 * pero que todavía no viajó — exactamente lo que el control de revisiones existe para evitar.
 */
async function mergeSincronizable<T extends { sync_status: SyncStatus }>(
  tabla: Table<T, string>,
  filasServidor: T[],
  idDe: (fila: T) => string,
): Promise<void> {
  if (filasServidor.length === 0) return;
  await db.transaction('rw', tabla, async () => {
    for (const filaServidor of filasServidor) {
      const clave = idDe(filaServidor);
      const local = await tabla.get(clave);
      if (local && (local.sync_status === 'pending' || local.sync_status === 'conflict' || local.sync_status === 'rechazado')) continue;
      await tabla.put({ ...filaServidor, sync_status: 'synced' });
    }
  });
}

async function mergeCambios(cambios: CambiosServidor, idEspacio: string): Promise<void> {
  await mergeSincronizable<Transaccion>(db.transacciones, cambios.transacciones, (f) => f.id_transaccion);
  await mergeSincronizable<Deuda>(db.deudas, cambios.deudas, (f) => f.id_deuda);
  await mergeSincronizable<Presupuesto>(db.presupuestos, cambios.presupuestos, (f) => f.id_presupuesto);
  // categorias/cuentas/usuarios son de solo lectura para el cliente (no se editan offline):
  // siempre se pisan con lo último del servidor, no tienen sync_status que respetar.
  if (cambios.categorias.length) await db.categorias.bulkPut(cambios.categorias);
  if (cambios.cuentas.length) await db.cuentas.bulkPut(cambios.cuentas);
  // Categorías y cuentas llegan COMPLETAS (solo las activas del espacio), no incrementales:
  // lo que el teléfono tiene de ese espacio y ya no vino fue desactivado en el servidor.
  // Sin esto, una categoría dada de baja seguía apareciendo para siempre en el celular.
  // Con la lista vacía no se borra nada: podría ser un backend viejo o una respuesta parcial.
  if (cambios.categorias.length) {
    const vigentes = new Set(cambios.categorias.map((c) => c.id_categoria));
    await db.categorias.where('id_espacio').equals(idEspacio).filter((c) => !vigentes.has(c.id_categoria)).delete();
  }
  if (cambios.cuentas.length) {
    const vigentes = new Set(cambios.cuentas.map((c) => c.id_cuenta));
    await db.cuentas.where('id_espacio').equals(idEspacio).filter((c) => !vigentes.has(c.id_cuenta)).delete();
  }
  if (cambios.usuarios.length) await db.usuarios.bulkPut(cambios.usuarios);
  if (cambios.trabajadores?.length) await db.trabajadores.bulkPut(cambios.trabajadores);
  if (cambios.prestamos?.length) await db.prestamos.bulkPut(cambios.prestamos);
}

// ---------------------------------------------------------------------------------------------
// Espacios (CONTRACT § 0.3), Solicitudes (§ 4-bis) y Obligaciones (§ 4-ter): ninguna de las
// tres es sincronizable — no viajan en `cambios` del endpoint `sincronizar` — así que se
// refrescan aparte con sus propios GET, en el mismo momento en que ya sabemos que hay
// conexión (justo después de un `sincronizar` exitoso) y también cuando la UI cambia de
// espacio (ver data/api.ts cambiarEspacio). Un fallo acá nunca es fatal: se sigue viendo
// el último cache de Dexie hasta el próximo intento.

async function refrescarEspacios(): Promise<void> {
  try {
    const espacios = await getEspaciosRemoto();
    if (espacios.length) await db.espacios.bulkPut(espacios);
  } catch {
    // Sin conexión real al Web App (ej. modo demo con VITE_API_URL de relleno): se ignora,
    // los dos espacios sembrados por la migración v3 de Dexie siguen sirviendo de cache.
  }
}

/** Exportada para que data/api.ts la dispare también al cambiar de espacio (cambiarEspacio),
 * sin esperar al próximo ciclo de `sincronizarAhora`. */
export async function refrescarSolicitudesYObligaciones(idEspacioForzado?: string): Promise<void> {
  if (!navigator.onLine) return;
  const sesion = await getSesion();
  if (!sesion) return;

  const idEspacio = idEspacioForzado ?? (await getEspacioActivoId());
  try {
    const [solicitudes, obligaciones] = await Promise.all([
      getSolicitudesRemoto(idEspacio),
      getObligacionesRemoto(idEspacio),
    ]);
    if (solicitudes.length) await db.solicitudes.bulkPut(solicitudes);
    if (obligaciones.length) await db.obligaciones.bulkPut(obligaciones);
  } catch {
    // Leer offline se resuelve con lo que ya haya en Dexie (CONTRACT § 2, última nota);
    // solo crear/responder/administrar exige conexión de verdad, eso lo valida data/api.ts.
  }
}

// ---------------------------------------------------------------------------------------------
// Resolución de conflictos (screens/Conflictos.tsx)

async function ponerVersionServidor(entidad: EntidadConTabla, version: Record<string, unknown>): Promise<void> {
  switch (entidad) {
    case 'transaccion':
      await db.transacciones.put({ ...(version as unknown as Transaccion), sync_status: 'synced' });
      return;
    case 'deuda':
      await db.deudas.put({ ...(version as unknown as Deuda), sync_status: 'synced' });
      return;
    case 'presupuesto':
      await db.presupuestos.put({ ...(version as unknown as Presupuesto), sync_status: 'synced' });
      return;
  }
}

async function eliminarFilaLocal(entidad: EntidadConTabla, id: string): Promise<void> {
  switch (entidad) {
    case 'transaccion':
      await db.transacciones.delete(id);
      return;
    case 'deuda':
      await db.deudas.delete(id);
      return;
    case 'presupuesto':
      await db.presupuestos.delete(id);
      return;
  }
}

/** Acciones que ofrece Conflictos.tsx: 'mia'/'servidor' para un conflicto real, 'corregir' solo para un rechazo. */
export type EleccionConflicto = 'mia' | 'servidor' | 'corregir';

export async function resolverConflicto(conflicto: Conflicto, eleccion: EleccionConflicto): Promise<void> {
  if (conflicto.estado === 'rechazado') {
    if (eleccion === 'corregir') {
      // El dato local ya tiene lo que el usuario mandó (quedó aplicado de forma optimista al
      // encolar); se deja tal cual y se marca 'pending' para que la UI lo siga señalando como
      // no sincronizado. No se re-encola automáticamente para no reintentar a ciegas el mismo
      // dato que el servidor ya rechazó una vez: el usuario lo corrige desde Gastos/Deudas y
      // esa edición sí vuelve a viajar con un op_id nuevo.
      await marcarEstado(conflicto.entidad, conflicto.id_registro, { sync_status: 'pending' });
      await db.conflictos.delete(conflicto.id_conflicto);
      return;
    }

    // 'servidor' hace de "Descartar". Si el registro nunca llegó a confirmarse contra el
    // servidor (rev === 0, el placeholder local de crearTransaccion/crearDeuda) no existe en
    // ningún lado más que acá y se borra. Si ya tenía una rev real (ej. un pago de deuda
    // rechazado sobre una deuda que sí existe en el servidor) se conserva y se acepta el
    // estado local tal cual quedó.
    const filaLocal = await obtenerFilaLocal(conflicto.entidad, conflicto.id_registro);
    if (filaLocal && filaLocal.rev === 0) {
      await eliminarFilaLocal(conflicto.entidad, conflicto.id_registro);
    } else {
      await marcarEstado(conflicto.entidad, conflicto.id_registro, { sync_status: 'synced' });
    }
    await db.conflictos.delete(conflicto.id_conflicto);
    return;
  }

  if (eleccion === 'servidor') {
    await ponerVersionServidor(conflicto.entidad, conflicto.version_servidor);
    await db.conflictos.delete(conflicto.id_conflicto);
    return;
  }

  // 'mia' (conflicto real; Conflictos.tsx nunca manda 'corregir' para este caso): reencola la
  // edición con rev_base = rev actual del servidor (el que causó el conflicto).
  const revServidor = Number(conflicto.version_servidor['rev']);
  const filaLocalMia = await obtenerFilaLocal(conflicto.entidad, conflicto.id_registro);
  await encolar(
    'editar',
    conflicto.entidad,
    conflicto.id_registro,
    conflicto.version_cliente,
    Number.isFinite(revServidor) ? revServidor : null,
    filaLocalMia?.id_espacio ?? String(conflicto.version_servidor['id_espacio'] ?? ''),
  );
  await marcarEstado(conflicto.entidad, conflicto.id_registro, { sync_status: 'pending' });
  await db.conflictos.delete(conflicto.id_conflicto);
}
