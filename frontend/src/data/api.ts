/**
 * Interfaz pública que consume la UI (CONTRACT § 6). La UI nunca llama a la red directamente:
 * todo pasa por acá, que lee de Dexie y encola mutaciones. La UI no sabe si hay conexión.
 *
 * Firmas exactas exigidas por CONTRACT § 6 "Interfaz entre los dos agentes de frontend" —
 * no se renombran ni se les cambia la forma, el agente de UI ya escribe contra ellas.
 */
import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Categoria,
  Cuenta,
  Deuda,
  Espacio,
  EstadoDeuda,
  EstadoSolicitud,
  ObligacionMensual,
  ResumenMensual,
  Sesion,
  SolicitudDinero,
  Transaccion,
  TipoMovimiento,
  Usuario,
} from './types';
import {
  crearObligacionRemota,
  crearSolicitudRemota,
  crearUsuarioRemoto,
  actualizarObligacionRemota,
  desactivarUsuarioRemoto,
  eliminarObligacionRemota,
  responderSolicitudRemota,
} from './cliente';
import { ahora, db, generarIdCliente, getEspacioActivoId, setEspacioActivoId } from '../offline/db';
import { encolar, hayOperacionPendiente } from '../offline/cola';
import { cerrarSesion, getSesion, iniciarSesion, onSesionChange } from '../offline/sesion';
import {
  iniciarMotorSync,
  onEstadoSyncChange,
  refrescarSolicitudesYObligaciones,
  sincronizandoAhora,
  sincronizarAhora,
} from '../offline/sync';

// Arranca el motor de sync una sola vez al cargar la app (iniciarMotorSync es idempotente).
// Es el único lugar del código que lo dispara: la UI nunca necesita saber que esto existe.
iniciarMotorSync();

// ---------------------------------------------------------------------------------------------
// Tipos auxiliares mencionados por las firmas de CONTRACT § 6 pero no definidos en data/types.ts
// (ese archivo es de solo lectura para este agente). El contrato no especifica sus campos
// exactos — TODO(contrato): quedan elegidos acá según lo que la UI necesita filtrar/crear.

/** Filtro para useTransacciones(). Todos los campos son opcionales y se combinan con AND. */
export interface FiltroGastos {
  id_usuario?: string;
  id_categoria?: string;
  id_cuenta?: string;
  tipo?: TipoMovimiento;
  mes?: number;
  anio?: number;
  /** Búsqueda de texto libre sobre descripción y notas. */
  texto?: string;
}

/** Campos que la UI manda para crear una transacción; el resto lo completa la capa de datos. */
export interface NuevaTransaccion {
  id_cuenta: string;
  id_categoria: string;
  tipo: TipoMovimiento;
  monto: number;
  descripcion: string;
  fecha: string;
  hora?: string;
  ubicacion?: string;
  notas?: string;
  /** A nombre de quién queda el movimiento; por defecto el usuario de la sesión actual. */
  id_usuario?: string;
}

/** Campos que la UI manda para crear una deuda; el resto lo completa la capa de datos. */
export interface NuevaDeuda {
  tipo: 'me_deben' | 'debo';
  persona: string;
  monto_original: number;
  descripcion: string;
  fecha_vencimiento: string;
  recordatorio?: boolean;
  notas?: string;
}

// ---------------------------------------------------------------------------------------------
// Sesión (implementación real en offline/sesion.ts)

export { getSesion, onSesionChange, iniciarSesion, cerrarSesion };

// ---------------------------------------------------------------------------------------------
// Lectura reactiva

export function useTransacciones(filtro?: FiltroGastos): Transaccion[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    let filas = (await db.transacciones.toArray()).filter((t) => !t.eliminado && t.id_espacio === idEspacio);

    if (filtro?.id_usuario) filas = filas.filter((t) => t.id_usuario === filtro.id_usuario);
    if (filtro?.id_categoria) filas = filas.filter((t) => t.id_categoria === filtro.id_categoria);
    if (filtro?.id_cuenta) filas = filas.filter((t) => t.id_cuenta === filtro.id_cuenta);
    if (filtro?.tipo) filas = filas.filter((t) => t.tipo === filtro.tipo);
    if (filtro?.mes !== undefined && filtro?.anio !== undefined) {
      const { mes, anio } = filtro;
      filas = filas.filter((t) => perteneceAMes(t.fecha, mes, anio));
    }
    if (filtro?.texto) {
      const q = filtro.texto.toLowerCase();
      filas = filas.filter((t) => t.descripcion.toLowerCase().includes(q) || t.notas.toLowerCase().includes(q));
    }

    // Más reciente primero. 'yyyy-MM-dd' ordena bien como string; a igual fecha, por hora.
    return filas.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  }, [filtro?.id_usuario, filtro?.id_categoria, filtro?.id_cuenta, filtro?.tipo, filtro?.mes, filtro?.anio, filtro?.texto]);
}

export function useResumenMensual(mes: number, anio: number): ResumenMensual | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [transacciones, categorias, presupuestos] = await Promise.all([
      db.transacciones.toArray(),
      db.categorias.toArray(),
      db.presupuestos.toArray(),
    ]);

    const delMes = transacciones.filter(
      (t) => !t.eliminado && t.id_espacio === idEspacio && perteneceAMes(t.fecha, mes, anio),
    );
    const total_ingresos = delMes.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0);
    const total_gastos = delMes.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);

    const gastoPorCategoria = new Map<string, number>();
    for (const t of delMes) {
      if (t.tipo !== 'gasto') continue;
      gastoPorCategoria.set(t.id_categoria, (gastoPorCategoria.get(t.id_categoria) ?? 0) + t.monto);
    }

    const por_categoria = Array.from(gastoPorCategoria.entries())
      .map(([id_categoria, total]) => {
        const categoria = categorias.find((c) => c.id_categoria === id_categoria);
        const presupuesto = presupuestos.find(
          (p) => !p.eliminado && p.id_espacio === idEspacio && p.id_categoria === id_categoria && p.mes === mes && p.anio === anio,
        );
        return {
          id_categoria,
          nombre: categoria?.nombre ?? 'Sin categoría',
          color: categoria?.color ?? '#86868B',
          icono: categoria?.icono ?? '',
          total,
          proporcion: total_gastos > 0 ? total / total_gastos : 0,
          limite: presupuesto?.monto_limite,
          grupo: categoria?.grupo ?? '',
        };
      })
      .sort((a, b) => b.total - a.total);

    return { mes, anio, total_ingresos, total_gastos, saldo: total_ingresos - total_gastos, por_categoria };
  }, [mes, anio]);
}

/**
 * Tendencia de ingresos/gastos de los últimos `meses` meses, terminando en el mes calendario
 * actual (backend/lib_calculos.js calcularTendencia tiene la misma forma, pero acá se calcula
 * sobre Dexie en una sola pasada para que funcione sin conexión, igual que el resto de hooks).
 */
/**
 * Los `meses` que terminan en (mesHasta, anioHasta) inclusive. Sin ancla explícita
 * termina en el mes actual; Resumen le pasa el mes del selector para que el gráfico
 * y el saldo de arriba hablen del mismo período.
 */
export function useTendencia(
  meses: number,
  mesHasta?: number,
  anioHasta?: number,
): Array<{ mes: number; anio: number; ingresos: number; gastos: number }> | undefined {
  return useLiveQuery(async () => {
    const hoy = new Date();
    const puntos = mesesHaciaAtras(
      mesHasta ?? hoy.getMonth() + 1,
      anioHasta ?? hoy.getFullYear(),
      meses,
    );

    const idEspacio = await getEspacioActivoId();
    const transacciones = (await db.transacciones.toArray()).filter((t) => !t.eliminado && t.id_espacio === idEspacio);
    const totalesPorMes = new Map<string, { ingresos: number; gastos: number }>();
    for (const t of transacciones) {
      const clave = t.fecha.slice(0, 7); // 'yyyy-MM'
      const actual = totalesPorMes.get(clave) ?? { ingresos: 0, gastos: 0 };
      if (t.tipo === 'ingreso') actual.ingresos += t.monto;
      else actual.gastos += t.monto;
      totalesPorMes.set(clave, actual);
    }

    return puntos.map(({ mes, anio }) => {
      const clave = `${anio}-${String(mes).padStart(2, '0')}`;
      const totales = totalesPorMes.get(clave);
      return { mes, anio, ingresos: totales?.ingresos ?? 0, gastos: totales?.gastos ?? 0 };
    });
  }, [meses, mesHasta, anioHasta]);
}

/** `cantidad` meses terminando en (mesBase, anioBase) inclusive, en orden cronológico ascendente. */
function mesesHaciaAtras(mesBase: number, anioBase: number, cantidad: number): Array<{ mes: number; anio: number }> {
  const puntos: Array<{ mes: number; anio: number }> = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    // % en JS puede dar negativo; se normaliza sumando 12 antes del módulo.
    const total = mesBase - 1 - i;
    const mes = (((total % 12) + 12) % 12) + 1;
    const anio = anioBase + Math.floor(total / 12);
    puntos.push({ mes, anio });
  }
  return puntos;
}

export function useDeudas(): Deuda[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const filas = (await db.deudas.toArray()).filter((d) => !d.eliminado && d.id_espacio === idEspacio);
    return filas.sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
  });
}

export function useCategorias(tipo?: TipoMovimiento): Categoria[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    let filas = (await db.categorias.toArray()).filter((c) => c.activo && c.id_espacio === idEspacio);
    if (tipo) filas = filas.filter((c) => c.tipo === tipo);
    return filas.sort((a, b) => a.orden - b.orden);
  }, [tipo]);
}

export function useCuentas(): Cuenta[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const filas = (await db.cuentas.toArray()).filter((c) => c.activo && c.id_espacio === idEspacio);
    return filas.sort((a, b) => a.orden - b.orden);
  });
}

// useUsuarios() NO filtra por espacio a propósito: los miembros activos pertenecen a los dos
// espacios por igual (CONTRACT § 0.3, "Todos los miembros activos pertenecen a los dos").
export function useUsuarios(): Usuario[] | undefined {
  return useLiveQuery(async () => {
    const filas = (await db.usuarios.toArray()).filter((u) => u.activo);
    return filas.sort((a, b) => a.nombre.localeCompare(b.nombre));
  });
}

// ---------------------------------------------------------------------------------------------
// Espacio activo (CONTRACT § 0.3 / § 6). Todos los hooks de arriba se filtran por él
// implícitamente leyendo getEspacioActivoId() dentro de su propia liveQuery — Dexie repite la
// consulta sola cuando cambia la fila de `meta` que guarda la selección, así que la UI nunca
// tiene que pasarlo a mano ni acordarse de que existe.

export function useEspacioActivo(): { id_espacio: string; nombre: string; icono: string } | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const espacio = await db.espacios.get(idEspacio);
    if (!espacio) return undefined;
    return { id_espacio: espacio.id_espacio, nombre: espacio.nombre, icono: espacio.icono };
  });
}

export function useEspacios(): Espacio[] | undefined {
  return useLiveQuery(async () => {
    const filas = (await db.espacios.toArray()).filter((e) => e.activo);
    // 'ESP_FAMILIA' < 'ESP_TELCOM' alfabéticamente: alcanza para un orden estable sin
    // necesitar un campo `orden` que el esquema de Espacios (CONTRACT § 2) no tiene.
    return filas.sort((a, b) => a.id_espacio.localeCompare(b.id_espacio));
  });
}

export async function cambiarEspacio(idEspacio: string): Promise<void> {
  await setEspacioActivoId(idEspacio);
  // Best-effort: si hay señal, trae de una vez las solicitudes/obligaciones del espacio nuevo
  // en vez de esperar al próximo ciclo de sincronizarAhora (hasta 5 minutos).
  void refrescarSolicitudesYObligaciones(idEspacio);
}

export function useEstadoSync(): { pendientes: number; sincronizando: boolean; enLinea: boolean } {
  // Pendientes SOLO del espacio activo: si Familia tiene 3 operaciones sin mandar, Telcom no
  // debería mostrar "3 pendientes" al usuario que está mirando su propio libro, sano y sincronizado.
  const pendientes =
    useLiveQuery(async () => {
      const idEspacio = await getEspacioActivoId();
      return db.cola.where('id_espacio').equals(idEspacio).count();
    }, [], 0) ?? 0;
  const sincronizando = useSyncExternalStore(onEstadoSyncChange, sincronizandoAhora, sincronizandoAhora);
  const enLinea = useSyncExternalStore(suscribirseAOnline, leerEnLinea, leerEnLinea);
  return { pendientes, sincronizando, enLinea };
}

function suscribirseAOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
function leerEnLinea(): boolean {
  return navigator.onLine;
}

function perteneceAMes(fechaYmd: string, mes: number, anio: number): boolean {
  const [anioFecha, mesFecha] = fechaYmd.split('-').map(Number);
  return anioFecha === anio && mesFecha === mes;
}

// ---------------------------------------------------------------------------------------------
// Escritura optimista: escribe en Dexie con sync_status='pending' y encola la operación.
// La UI se entera del cambio al instante porque useLiveQuery reacciona a la escritura en Dexie,
// no a la respuesta de red.

async function sesionRequerida(): Promise<Sesion> {
  const sesion = await getSesion();
  if (!sesion) throw new Error('No hay sesión activa');
  return sesion;
}

export async function crearTransaccion(t: NuevaTransaccion): Promise<void> {
  const sesion = await sesionRequerida();
  const idEspacio = await getEspacioActivoId();
  const id_transaccion = generarIdCliente('TRX');
  const momento = ahora();
  const fila: Transaccion = {
    id_transaccion,
    id_espacio: idEspacio,
    id_usuario: t.id_usuario ?? sesion.usuario.id_usuario,
    id_cuenta: t.id_cuenta,
    id_categoria: t.id_categoria,
    tipo: t.tipo,
    monto: t.monto,
    descripcion: t.descripcion,
    fecha: t.fecha,
    hora: t.hora ?? '',
    ubicacion: t.ubicacion ?? '',
    notas: t.notas ?? '',
    rev: 0, // placeholder local; el servidor asigna el rev real (empieza en 1) al confirmar.
    origen: 'app',
    eliminado: false,
    fecha_creacion: momento,
    fecha_modificacion: momento,
    sync_status: 'pending',
  };
  await db.transacciones.put(fila);
  const { sync_status: _s, rev_base: _r, ...datos } = fila;
  await encolar('crear', 'transaccion', id_transaccion, datos, null, idEspacio);
  void sincronizarAhora();
}

export async function editarTransaccion(id: string, cambios: Partial<Transaccion>): Promise<void> {
  const actual = await db.transacciones.get(id);
  if (!actual) throw new Error(`Transacción ${id} no encontrada`);
  // rev_base = el rev que tenía el registro al empezar ESTA edición. Si ya había una edición
  // pendiente sin sincronizar, cola.encolar() funde ambas y conserva el rev_base original —
  // acá siempre se manda el rev local actual, que es el correcto para el caso común (primera
  // edición offline de este registro).
  const revBase = actual.rev;
  await db.transacciones.put({ ...actual, ...cambios, fecha_modificacion: ahora(), sync_status: 'pending' });
  const { sync_status: _s, rev_base: _r, ...datosCambios } = cambios;
  await encolar('editar', 'transaccion', id, datosCambios, revBase, actual.id_espacio);
  void sincronizarAhora();
}

export async function eliminarTransaccion(id: string): Promise<void> {
  const actual = await db.transacciones.get(id);
  if (!actual) return;
  const revBase = actual.rev;
  await encolar('eliminar', 'transaccion', id, {}, revBase, actual.id_espacio);
  if (await hayOperacionPendiente('transaccion', id)) {
    // Caso normal: había algo que confirmar en el servidor. Se marca eliminado y se espera
    // la confirmación — nunca se borra la fila local antes de tiempo.
    await db.transacciones.put({ ...actual, eliminado: true, fecha_modificacion: ahora(), sync_status: 'pending' });
  } else {
    // encolar() detectó que era un "crear" que todavía no había viajado al servidor y limpió
    // la cola entera: ese registro no existe en ningún lado más que acá, se borra sin más.
    await db.transacciones.delete(id);
  }
  void sincronizarAhora();
}

export async function crearDeuda(d: NuevaDeuda): Promise<void> {
  const sesion = await sesionRequerida();
  const idEspacio = await getEspacioActivoId();
  const id_deuda = generarIdCliente('DDA');
  const momento = ahora();
  const fila: Deuda = {
    id_deuda,
    id_espacio: idEspacio,
    id_usuario: sesion.usuario.id_usuario,
    tipo: d.tipo,
    persona: d.persona,
    monto_original: d.monto_original,
    monto_pendiente: d.monto_original,
    descripcion: d.descripcion,
    fecha_creacion: momento,
    fecha_vencimiento: d.fecha_vencimiento,
    estado: 'pendiente',
    recordatorio: d.recordatorio ?? true,
    notas: d.notas ?? '',
    rev: 0,
    origen: 'app',
    eliminado: false,
    sync_status: 'pending',
  };
  await db.deudas.put(fila);
  const { sync_status: _s, rev_base: _r, ...datos } = fila;
  await encolar('crear', 'deuda', id_deuda, datos, null, idEspacio);
  void sincronizarAhora();
}

export async function registrarPagoDeuda(idDeuda: string, monto: number): Promise<void> {
  const actual = await db.deudas.get(idDeuda);
  if (!actual) throw new Error(`Deuda ${idDeuda} no encontrada`);
  // rev_base = el rev de la DEUDA al momento de registrar el pago (CONTRACT § 4, "Entidad
  // pago_deuda"), no el rev de un pago anterior: el pago en sí no tiene rev propio, es la
  // deuda la que sube de rev cuando el servidor lo aplica.
  const revBase = actual.rev;
  const monto_pendiente = Math.max(0, actual.monto_pendiente - monto);
  const estado: EstadoDeuda = monto_pendiente <= 0 ? 'pagada' : actual.estado;
  // Aplicación optimista local para que la UI reaccione al instante; la respuesta del
  // servidor (offline/sync.ts) reemplaza esta fila con la deuda autoritativa cuando llega.
  await db.deudas.put({ ...actual, monto_pendiente, estado, sync_status: 'pending' });

  const id_pago = generarIdCliente('PAG');
  await encolar(
    'crear',
    'pago_deuda',
    id_pago,
    { id_deuda: idDeuda, monto, fecha: ahora().slice(0, 10), notas: '' },
    revBase,
    actual.id_espacio,
  );
  void sincronizarAhora();
}

// ---------------------------------------------------------------------------------------------
// Administración de usuarios: requieren conexión (ver TODO en data/cliente.ts). No pasan por
// la cola offline porque 'usuario' no es una entidad sincronizable en CONTRACT § 4.

export async function crearUsuario(u: { nombre: string; email: string }): Promise<void> {
  const usuario = await crearUsuarioRemoto(u);
  await db.usuarios.put(usuario);
}

export async function desactivarUsuario(idUsuario: string): Promise<void> {
  await desactivarUsuarioRemoto(idUsuario);
  const actual = await db.usuarios.get(idUsuario);
  if (actual) await db.usuarios.put({ ...actual, activo: false });
}

// ---------------------------------------------------------------------------------------------
// Solicitudes de dinero (CONTRACT § 4-bis) y Obligaciones mensuales (CONTRACT § 4-ter).
//
// Ninguna de las dos es sincronizable (CONTRACT § 2, última nota): no llevan `rev`, no entran
// en el lote de `sincronizar`, y por eso no pasan por offline/cola.ts. Se LEEN desde Dexie para
// poder verlas sin señal (el cache lo llena offline/sync.ts en cada sincronización exitosa y al
// cambiar de espacio), pero crear/responder/administrar exige conexión real: es la única
// excepción a "la UI no sabe si hay conexión" que el propio contrato pide explícitamente, así
// que el chequeo vive acá (capa de datos), nunca en un componente de pantalla.

function requiereConexion(): void {
  if (!navigator.onLine) {
    throw new Error('Esto necesita conexión a internet — no se puede dejar pendiente para más tarde.');
  }
}

/** Campos que la UI manda para crear una solicitud; el resto lo completa el servidor. */
export interface NuevaSolicitud {
  monto: number;
  motivo: string;
  id_categoria: string;
}

export function useSolicitudes(estado?: EstadoSolicitud): SolicitudDinero[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    let filas = (await db.solicitudes.toArray()).filter((s) => !s.eliminado && s.id_espacio === idEspacio);
    if (estado) filas = filas.filter((s) => s.estado === estado);
    return filas.sort((a, b) => b.fecha_solicitud.localeCompare(a.fecha_solicitud));
  }, [estado]);
}

export async function crearSolicitud(s: NuevaSolicitud): Promise<void> {
  requiereConexion();
  const sesion = await sesionRequerida();
  const idEspacio = await getEspacioActivoId();
  const solicitud = await crearSolicitudRemota({
    id_espacio: idEspacio,
    id_solicitante: sesion.usuario.id_usuario,
    monto: s.monto,
    motivo: s.motivo,
    id_categoria: s.id_categoria,
  });
  await db.solicitudes.put(solicitud);
}

/** Solo propietario (CONTRACT § 4-bis). Aprobar crea de una vez la transacción de gasto; el
 * cache local de transacciones se pone al día en el próximo sincronizarAhora(), no acá. */
export async function responderSolicitud(id: string, aprobar: boolean, motivo?: string): Promise<void> {
  requiereConexion();
  const solicitud = await responderSolicitudRemota(id, aprobar, motivo);
  await db.solicitudes.put(solicitud);
  if (aprobar) void sincronizarAhora();
}

/** Campos que la UI manda para crear una obligación; el resto lo completa el servidor. */
export interface NuevaObligacion {
  concepto: string;
  id_categoria: string;
  id_cuenta: string;
  monto_estimado: number;
  dia_vencimiento: number;
  notas?: string;
}

export function useObligaciones(): ObligacionMensual[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const filas = (await db.obligaciones.toArray()).filter((o) => !o.eliminado && o.id_espacio === idEspacio);
    return filas.sort((a, b) => a.dia_vencimiento - b.dia_vencimiento);
  });
}

export async function crearObligacion(o: NuevaObligacion): Promise<void> {
  requiereConexion();
  const idEspacio = await getEspacioActivoId();
  const obligacion = await crearObligacionRemota({ id_espacio: idEspacio, ...o });
  await db.obligaciones.put(obligacion);
}

export async function actualizarObligacion(id: string, cambios: Partial<ObligacionMensual>): Promise<void> {
  requiereConexion();
  const obligacion = await actualizarObligacionRemota(id, cambios);
  await db.obligaciones.put(obligacion);
}

/** Baja lógica: `activo = false` (CONTRACT § 4-ter), deja intactas las deudas ya generadas. */
export async function eliminarObligacion(id: string): Promise<void> {
  requiereConexion();
  await eliminarObligacionRemota(id);
  const actual = await db.obligaciones.get(id);
  if (actual) await db.obligaciones.put({ ...actual, activo: false });
}

export { sincronizarAhora };
