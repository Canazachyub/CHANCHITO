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
  Trabajador,
  Prestamo,
  Transaccion,
  TipoMovimiento,
  Usuario,
} from './types';
import {
  crearObligacionRemota,
  crearSolicitudRemota,
  crearUsuarioRemoto,
  restablecerPasswordRemoto,
  type NuevoUsuarioRemoto,
  actualizarObligacionRemota,
  desactivarUsuarioRemoto,
  eliminarObligacionRemota,
  responderSolicitudRemota,
  crearTrabajadorRemoto,
  actualizarTrabajadorRemoto,
  darDeBajaTrabajadorRemoto,
  type PayloadTrabajador,
  actualizarCuentaRemota,
  crearPrestamoRemoto,
  actualizarPrestamoRemoto,
  finalizarPrestamoRemoto,
} from './cliente';
import {
  calcularIndicadores,
  fichasTrabajadores,
  generarCsv,
  resumenPorPersona,
  serieMensual,
  saldosPorCuenta,
  variacionesPorCategoria,
  type FichaTrabajador,
  type PuntoMensual,
  type Indicadores,
  type ResumenPersona,
  type SaldoCuenta,
  type VariacionCategoria,
} from './analisis';
import { construirTablero, type Tablero } from './tablero';
import { auditar, type Hallazgo } from './auditoria';
import { repartirPagoCuota, resumenPrestamo, type CuotaCronograma, type ResumenPrestamo } from './prestamos';
import { ahora, db, generarIdCliente, getEspacioActivoId, setEspacioActivoId } from '../offline/db';
import { encolar, hayOperacionPendiente } from '../offline/cola';
import { cambiarPassword, cerrarSesion, getSesion, iniciarSesion, iniciarSesionConPassword, onSesionChange } from '../offline/sesion';
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
  /** A qué trabajador se le pagó (pagos de personal, CONTRACT § 4-quater). */
  id_trabajador?: string;
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
  id_trabajador?: string;
  id_prestamo?: string;
  nro_cuota?: number;
  capital?: number;
  interes?: number;
  otros?: number;
}

// ---------------------------------------------------------------------------------------------
// Sesión (implementación real en offline/sesion.ts)

export { getSesion, onSesionChange, iniciarSesion, iniciarSesionConPassword, cambiarPassword, cerrarSesion };

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

/** Devuelve el id generado para poder enlazarla (p. ej. al pago de una deuda). */
export async function crearTransaccion(t: NuevaTransaccion): Promise<string> {
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
    id_trabajador: t.id_trabajador ?? '',
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
  return id_transaccion;
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
    id_trabajador: d.id_trabajador ?? '',
    ...(d.id_prestamo
      ? { id_prestamo: d.id_prestamo, nro_cuota: d.nro_cuota, capital: d.capital, interes: d.interes, otros: d.otros }
      : {}),
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

/** Con qué categoría y cuenta queda registrado el pago como movimiento real. */
export interface MovimientoDePago {
  id_categoria: string;
  id_cuenta: string;
}

/**
 * `movimiento`: además de bajar la deuda, registra el gasto (si la debemos) o el ingreso (si nos
 * la deben) y lo enlaza al pago. Sin esto la planilla pagada nunca aparecía en los gastos ni en
 * el análisis. Se omite cuando no se mueve plata, como al descontar un adelanto del sueldo.
 */
export async function registrarPagoDeuda(idDeuda: string, monto: number, movimiento?: MovimientoDePago): Promise<void> {
  const actual = await db.deudas.get(idDeuda);
  if (!actual) throw new Error(`Deuda ${idDeuda} no encontrada`);

  // Se encola ANTES que el pago: la cola es FIFO, así el servidor ya tiene la transacción
  // cuando el pago la referencia por id.
  let id_transaccion = '';
  if (movimiento && actual.id_prestamo) {
    // Cuota de préstamo: el interés es costo y el capital es devolver deuda. Van a categorías
    // distintas para que el análisis no cuente la amortización como gasto operativo.
    id_transaccion = await registrarPagoCuotaComoMovimientos(actual, monto, movimiento.id_cuenta);
  } else if (movimiento) {
    id_transaccion = await crearTransaccion({
      id_categoria: movimiento.id_categoria,
      id_cuenta: movimiento.id_cuenta,
      tipo: actual.tipo === 'debo' ? 'gasto' : 'ingreso',
      monto,
      descripcion: `${actual.tipo === 'debo' ? 'Pago' : 'Cobro'}: ${actual.persona}`,
      fecha: ahora().slice(0, 10),
      hora: ahora().slice(11),
      id_trabajador: actual.id_trabajador || '',
    });
  }
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
    { id_deuda: idDeuda, monto, fecha: ahora().slice(0, 10), notas: '', id_transaccion },
    revBase,
    actual.id_espacio,
  );
  void sincronizarAhora();
}

// ---------------------------------------------------------------------------------------------
// Administración de usuarios: requieren conexión (ver TODO en data/cliente.ts). No pasan por
// la cola offline porque 'usuario' no es una entidad sincronizable en CONTRACT § 4.

/**
 * Alta de usuario (solo propietario, con conexión). Con `usuario`, devuelve la contraseña
 * temporal que generó el servidor: la UI la muestra una única vez y no la guarda en ningún lado.
 */
export async function crearUsuario(u: NuevoUsuarioRemoto): Promise<{ password_temporal?: string; id_usuario: string }> {
  requiereConexion();
  const r = await crearUsuarioRemoto(u);
  await db.usuarios.put(r.usuario);
  void sincronizarAhora();
  return { password_temporal: r.password_temporal, id_usuario: r.usuario.id_usuario };
}

/** Solo propietario. Nueva contraseña temporal (se muestra una vez) y obliga a cambiarla. */
export async function restablecerPassword(idUsuario: string): Promise<string> {
  requiereConexion();
  return restablecerPasswordRemoto(idUsuario);
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
  id_trabajador?: string;
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

// ---------------------------------------------------------------------------------------------
// Trabajadores (CONTRACT § 4-quater). Misma regla que Obligaciones: se leen de Dexie, se escriben
// solo con conexión y solo el propietario.

/** En modo demo no hay backend: alta y edición se aplican solo en Dexie para poder probarlas. */
const MODO_DEMO = import.meta.env.VITE_DEMO === 'true' && !import.meta.env.PROD;

/** Activos primero y por nombre. `incluirBajas` para Administración, que puede reactivarlos. */
export function useTrabajadores(incluirBajas = false): Trabajador[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    let filas = await db.trabajadores.where('id_espacio').equals(idEspacio).toArray();
    if (!incluirBajas) filas = filas.filter((t) => t.activo);
    return filas.sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre));
  }, [incluirBajas]);
}

export type NuevoTrabajador = Pick<Trabajador, 'nombre' | 'tipo_vinculo'> &
  Partial<Pick<Trabajador, 'documento' | 'cargo' | 'proyecto' | 'sueldo_base' | 'pension' | 'fecha_ingreso' | 'fecha_fin' | 'notas'>>;

export async function crearTrabajador(t: NuevoTrabajador): Promise<void> {
  const idEspacio = await getEspacioActivoId();
  if (MODO_DEMO) {
    const momento = ahora();
    await db.trabajadores.put({
      id_trabajador: `TRB_${crypto.randomUUID().split('-')[0]}`,
      id_espacio: idEspacio,
      nombre: t.nombre,
      documento: t.documento ?? '',
      tipo_vinculo: t.tipo_vinculo,
      cargo: t.cargo ?? '',
      proyecto: t.proyecto ?? '',
      sueldo_base: t.sueldo_base ?? 0,
      pension: t.pension ?? '',
      fecha_ingreso: t.fecha_ingreso ?? '',
      fecha_fin: t.fecha_fin ?? '',
      id_usuario: '',
      activo: true,
      notas: t.notas ?? '',
      fecha_creacion: momento,
      fecha_modificacion: momento,
    });
    return;
  }
  requiereConexion();
  await db.trabajadores.put(await crearTrabajadorRemoto({ id_espacio: idEspacio, ...t }));
}

/** También sirve para reactivar (`{ activo: true }`) a alguien dado de baja por error. */
export async function actualizarTrabajador(id: string, cambios: PayloadTrabajador): Promise<void> {
  if (MODO_DEMO) {
    await db.trabajadores.update(id, { ...cambios, fecha_modificacion: ahora() });
    return;
  }
  requiereConexion();
  await db.trabajadores.put(await actualizarTrabajadorRemoto(id, cambios));
}

export async function darDeBajaTrabajador(id: string): Promise<void> {
  if (MODO_DEMO) {
    await db.trabajadores.update(id, { activo: false, fecha_modificacion: ahora() });
    return;
  }
  requiereConexion();
  await db.trabajadores.put(await darDeBajaTrabajadorRemoto(id));
}

// ---------------------------------------------------------------------------------------------
// Análisis del mes: una sola liveQuery junta las filas del espacio activo y delega en las
// funciones puras de data/analisis.ts.

export interface AnalisisMes {
  indicadores: Indicadores;
  por_persona: ResumenPersona[];
  variaciones: VariacionCategoria[];
  fichas: FichaTrabajador[];
  cuentas: SaldoCuenta[];
  /** true si es el mes actual: las variaciones comparan contra el promedio prorrateado. */
  mes_en_curso: boolean;
}

export function useAnalisisMes(mes: number, anio: number): AnalisisMes | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [transacciones, categorias, deudas, cuentas, usuarios, trabajadores] = await Promise.all([
      db.transacciones.where('id_espacio').equals(idEspacio).toArray(),
      db.categorias.where('id_espacio').equals(idEspacio).toArray(),
      db.deudas.where('id_espacio').equals(idEspacio).toArray(),
      db.cuentas.where('id_espacio').equals(idEspacio).toArray(),
      db.usuarios.toArray(),
      db.trabajadores.where('id_espacio').equals(idEspacio).toArray(),
    ]);
    const vivas = transacciones.filter((t) => !t.eliminado);
    const delMes = vivas.filter((t) => perteneceAMes(t.fecha, mes, anio));
    const deudasVivas = deudas.filter((d) => !d.eliminado);

    const hoy = new Date();
    const hoyYmd = ahora().slice(0, 10);
    const mes_en_curso = mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();
    const fraccion = mes_en_curso ? hoy.getDate() / new Date(anio, mes, 0).getDate() : 1;

    return {
      indicadores: calcularIndicadores(delMes, categorias, deudasVivas, mes, anio),
      por_persona: resumenPorPersona(delMes, usuarios, categorias),
      variaciones: variacionesPorCategoria(vivas, categorias, mes, anio, fraccion),
      fichas: fichasTrabajadores(trabajadores, vivas, deudasVivas, categorias, mes, anio, hoyYmd),
      cuentas: saldosPorCuenta(cuentas.filter((c) => c.activo), vivas, mes, anio),
      mes_en_curso,
    };
  }, [mes, anio]);
}

/** CSV del mes del espacio activo, listo para descargar. */
export async function exportarCsvMes(mes: number, anio: number): Promise<{ nombre: string; contenido: string }> {
  const idEspacio = await getEspacioActivoId();
  const [transacciones, categorias, cuentas, usuarios, trabajadores, espacio] = await Promise.all([
    db.transacciones.where('id_espacio').equals(idEspacio).toArray(),
    db.categorias.where('id_espacio').equals(idEspacio).toArray(),
    db.cuentas.where('id_espacio').equals(idEspacio).toArray(),
    db.usuarios.toArray(),
    db.trabajadores.where('id_espacio').equals(idEspacio).toArray(),
    db.espacios.get(idEspacio),
  ]);
  const delMes = transacciones.filter((t) => !t.eliminado && perteneceAMes(t.fecha, mes, anio));
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  return {
    nombre: `chanchito_${(espacio?.nombre ?? idEspacio).toLowerCase()}_${periodo}.csv`,
    contenido: generarCsv(delMes, { categorias, cuentas, usuarios, trabajadores }),
  };
}

export { sincronizarAhora };

// ---------------------------------------------------------------------------------------------
// Serie mensual para los gráficos de Resumen (G1–G4).

export function useSerieMensual(meses: number, mesHasta: number, anioHasta: number): PuntoMensual[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [transacciones, cuentas] = await Promise.all([
      db.transacciones.where('id_espacio').equals(idEspacio).toArray(),
      db.cuentas.where('id_espacio').equals(idEspacio).toArray(),
    ]);
    return serieMensual(cuentas, transacciones.filter((t) => !t.eliminado), meses, mesHasta, anioHasta);
  }, [meses, mesHasta, anioHasta]);
}

// ---------------------------------------------------------------------------------------------
// Tablero de hojas conectadas (data/tablero.ts): mismo modelo para la vista y el .xlsx.

export function useTablero(mes: number, anio: number): Tablero | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [transacciones, categorias, cuentas, deudas, trabajadores] = await Promise.all([
      db.transacciones.where('id_espacio').equals(idEspacio).toArray(),
      db.categorias.where('id_espacio').equals(idEspacio).toArray(),
      db.cuentas.where('id_espacio').equals(idEspacio).toArray(),
      db.deudas.where('id_espacio').equals(idEspacio).toArray(),
      db.trabajadores.where('id_espacio').equals(idEspacio).toArray(),
    ]);
    return construirTablero({
      transacciones: transacciones.filter((t) => !t.eliminado),
      categorias,
      cuentas: cuentas.filter((c) => c.activo),
      deudas: deudas.filter((d) => !d.eliminado),
      trabajadores,
      mes,
      anio,
      hoy: ahora().slice(0, 10),
    });
  }, [mes, anio]);
}

// ---------------------------------------------------------------------------------------------
// Correcciones puntuales que usa el Tablero (y cualquier otra pantalla): las mismas funciones
// en todos lados, así una corrección se ve igual en el dashboard, otra ventana o la APK.

export type CambiosDeuda = Partial<Pick<Deuda, 'monto_pendiente' | 'monto_original' | 'fecha_vencimiento' | 'persona' | 'descripcion'>>;

export async function editarDeuda(id: string, cambios: CambiosDeuda): Promise<void> {
  const actual = await db.deudas.get(id);
  if (!actual) throw new Error(`Deuda ${id} no encontrada`);
  const ajustados: CambiosDeuda = { ...cambios };
  if (ajustados.monto_pendiente !== undefined) {
    if (!Number.isFinite(ajustados.monto_pendiente) || ajustados.monto_pendiente < 0) throw new Error('El pendiente no puede ser negativo.');
    // No se sube el original por detrás: una corrección no puede cambiar en silencio otro campo
    // que después nadie vuelve a bajar. Si el original estaba mal, se corrige el original.
    const original = ajustados.monto_original ?? actual.monto_original;
    if (ajustados.monto_pendiente > original) {
      throw new Error(`El pendiente no puede pasar del monto original (${original}). Corrige primero el original.`);
    }
  }
  const pendiente = ajustados.monto_pendiente ?? actual.monto_pendiente;
  const estado: EstadoDeuda = pendiente <= 0 ? 'pagada' : actual.estado === 'pagada' ? 'pendiente' : actual.estado;
  await db.deudas.put({ ...actual, ...ajustados, estado, sync_status: 'pending' });
  await encolar('editar', 'deuda', id, { ...ajustados, estado }, actual.rev, actual.id_espacio);
  void sincronizarAhora();
}

/** Saldo inicial de una cuenta. Cuentas no es entidad sincronizable: exige conexión (salvo demo). */
export async function actualizarSaldoInicialCuenta(idCuenta: string, saldoInicial: number): Promise<void> {
  if (!Number.isFinite(saldoInicial)) throw new Error('Monto inválido.');
  if (!MODO_DEMO) {
    requiereConexion();
    await actualizarCuentaRemota(idCuenta, { saldo_inicial: saldoInicial });
  }
  await db.cuentas.update(idCuenta, { saldo_inicial: saldoInicial });
}

// ---------------------------------------------------------------------------------------------
// Préstamos bancarios (CONTRACT § 4-quinquies). La cabecera exige conexión (como Trabajadores);
// las cuotas son deudas y se crean por la cola offline, así que el cronograma queda registrado
// aunque se cargue en campo sin señal.

/** Nombres de las categorías de sistema que reciben el pago de una cuota (backend/00_config.js). */
export const CATEGORIA_INTERESES = 'Intereses y comisiones bancarias';
export const CATEGORIA_AMORTIZACION = 'Amortización de préstamos';
export const CATEGORIA_PRESTAMOS_RECIBIDOS = 'Préstamos recibidos';

async function categoriaPorNombre(idEspacio: string, nombre: string): Promise<string> {
  const cat = (await db.categorias.where('id_espacio').equals(idEspacio).toArray()).find((c) => c.nombre === nombre && c.activo);
  if (!cat) throw new Error(`Falta la categoría "${nombre}". Ejecuta inicializarSistema() en Apps Script para crearla.`);
  return cat.id_categoria;
}

/** Devuelve el id de la transacción de capital (o de costo si no hubo capital) para enlazar al pago. */
async function registrarPagoCuotaComoMovimientos(cuota: Deuda, monto: number, idCuenta: string): Promise<string> {
  const { costo, capital } = repartirPagoCuota(cuota, monto);
  const fecha = ahora().slice(0, 10);
  const hora = ahora().slice(11);
  const etiqueta = `${cuota.persona} · cuota ${cuota.nro_cuota ?? ''}`.trim();
  let idEnlace = '';
  if (costo > 0) {
    idEnlace = await crearTransaccion({
      id_categoria: await categoriaPorNombre(cuota.id_espacio, CATEGORIA_INTERESES),
      id_cuenta: idCuenta,
      tipo: 'gasto',
      monto: costo,
      descripcion: `Interés y seguro: ${etiqueta}`,
      fecha,
      hora,
    });
  }
  if (capital > 0) {
    idEnlace = await crearTransaccion({
      id_categoria: await categoriaPorNombre(cuota.id_espacio, CATEGORIA_AMORTIZACION),
      id_cuenta: idCuenta,
      tipo: 'gasto',
      monto: capital,
      descripcion: `Capital: ${etiqueta}`,
      fecha,
      hora,
    });
  }
  return idEnlace;
}

export function usePrestamos(): Array<{ prestamo: Prestamo; cuotas: Deuda[]; resumen: ResumenPrestamo }> | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [prestamos, deudas] = await Promise.all([
      db.prestamos.where('id_espacio').equals(idEspacio).toArray(),
      db.deudas.where('id_espacio').equals(idEspacio).toArray(),
    ]);
    const hoy = ahora().slice(0, 10);
    return prestamos
      .map((prestamo) => {
        const cuotas = deudas
          .filter((d) => !d.eliminado && d.id_prestamo === prestamo.id_prestamo)
          .sort((a, b) => (a.nro_cuota ?? 0) - (b.nro_cuota ?? 0));
        return { prestamo, cuotas, resumen: resumenPrestamo(cuotas, hoy) };
      })
      .sort((a, b) => Number(b.prestamo.activo) - Number(a.prestamo.activo) || (a.resumen.proxima?.fecha ?? '9').localeCompare(b.resumen.proxima?.fecha ?? '9'));
  });
}

export type NuevoPrestamo = Pick<Prestamo, 'entidad' | 'tipo' | 'descripcion' | 'monto' | 'tea' | 'plazo' | 'dia_pago' | 'fecha_desembolso' | 'id_cuenta' | 'notas'>;

/**
 * Registra el préstamo y sus cuotas pendientes.
 * - `cuotas`: el cronograma ya revisado contra el del banco (se puede corregir fila por fila).
 * - `cuotasYaPagadas`: para préstamos que vienen de antes; esas no se crean.
 * - `desembolsoEnCuenta`: si el dinero entra ahora a una cuenta, se registra como ingreso
 *   ("Préstamos recibidos") para que la caja cuadre. Para préstamos viejos, no.
 */
export async function crearPrestamo(
  datos: NuevoPrestamo,
  cuotas: CuotaCronograma[],
  opciones: { cuotasYaPagadas?: number; desembolsoEnCuenta?: string } = {},
): Promise<void> {
  const idEspacio = await getEspacioActivoId();
  const id_prestamo = `PRS_${crypto.randomUUID().split('-')[0]}`;
  const momento = ahora();
  const cabecera: Prestamo = { ...datos, id_prestamo, id_espacio: idEspacio, activo: true, fecha_creacion: momento, fecha_modificacion: momento };

  if (MODO_DEMO) {
    await db.prestamos.put(cabecera);
  } else {
    requiereConexion();
    await db.prestamos.put(await crearPrestamoRemoto({ ...datos, id_prestamo, id_espacio: idEspacio }));
  }

  const desde = opciones.cuotasYaPagadas ?? 0;
  for (const c of cuotas.filter((x) => x.nro > desde)) {
    await crearDeuda({
      tipo: 'debo',
      persona: datos.entidad,
      monto_original: c.cuota,
      descripcion: `${datos.descripcion || 'Préstamo'} · cuota ${c.nro}/${cuotas.length}`,
      fecha_vencimiento: c.fecha,
      recordatorio: true,
      id_prestamo,
      nro_cuota: c.nro,
      capital: c.capital,
      interes: c.interes,
      otros: c.otros,
    });
  }

  if (opciones.desembolsoEnCuenta) {
    await crearTransaccion({
      id_categoria: await categoriaPorNombre(idEspacio, CATEGORIA_PRESTAMOS_RECIBIDOS),
      id_cuenta: opciones.desembolsoEnCuenta,
      tipo: 'ingreso',
      monto: datos.monto,
      descripcion: `Desembolso ${datos.entidad}`,
      fecha: datos.fecha_desembolso,
    });
  }
}

export async function actualizarPrestamo(id: string, cambios: Partial<Prestamo>): Promise<void> {
  if (!MODO_DEMO) {
    requiereConexion();
    await db.prestamos.put(await actualizarPrestamoRemoto(id, cambios));
    return;
  }
  await db.prestamos.update(id, { ...cambios, fecha_modificacion: ahora() });
}

// ---------------------------------------------------------------------------------------------
// Auditoría (data/auditoria.ts): hallazgos del espacio activo para el mes elegido.

export function useAuditoria(mes: number, anio: number): Hallazgo[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [transacciones, categorias, cuentas, deudas, trabajadores, obligaciones, pendientesSync, conflictos] = await Promise.all([
      db.transacciones.where('id_espacio').equals(idEspacio).toArray(),
      db.categorias.where('id_espacio').equals(idEspacio).toArray(),
      db.cuentas.where('id_espacio').equals(idEspacio).toArray(),
      db.deudas.where('id_espacio').equals(idEspacio).toArray(),
      db.trabajadores.where('id_espacio').equals(idEspacio).toArray(),
      db.obligaciones.where('id_espacio').equals(idEspacio).toArray(),
      db.cola.where('id_espacio').equals(idEspacio).count(),
      db.conflictos.count(),
    ]);
    const vivas = transacciones.filter((t) => !t.eliminado);
    const deudasVivas = deudas.filter((d) => !d.eliminado);
    const hoy = ahora().slice(0, 10);
    return auditar({
      transacciones: vivas,
      categorias,
      deudas: deudasVivas,
      trabajadores,
      obligaciones,
      tablero: construirTablero({ transacciones: vivas, categorias, cuentas: cuentas.filter((c) => c.activo), deudas: deudasVivas, trabajadores, mes, anio, hoy }),
      pendientesSync,
      conflictos,
      mes,
      anio,
      hoy,
    });
  }, [mes, anio]);
}

// ---------------------------------------------------------------------------------------------
// Inicio móvil (Fase 3): resumen por rango arbitrario y uso reciente de categorías.

export interface ResumenRango {
  desde: string;
  hasta: string;
  ingresos: number;
  gastos: number;
  saldo: number;
  por_categoria: Array<{
    id_categoria: string;
    nombre: string;
    icono: string;
    color: string;
    grupo: string;
    total: number;
    /** 0..1 — fracción del gasto total del rango. */
    proporcion: number;
  }>;
  por_grupo: Array<{ grupo: string; total: number; proporcion: number }>;
}

/** Igual que useResumenMensual pero para [desde, hasta] ('yyyy-MM-dd', inclusive) del espacio activo. */
export function useResumenRango(desde: string, hasta: string): ResumenRango | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [transacciones, categorias] = await Promise.all([db.transacciones.toArray(), db.categorias.toArray()]);

    const delRango = transacciones.filter(
      (t) => !t.eliminado && t.id_espacio === idEspacio && t.fecha >= desde && t.fecha <= hasta,
    );
    const ingresos = delRango.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0);
    const gastos = delRango.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);

    const porCategoria = new Map<string, number>();
    const porGrupo = new Map<string, number>();
    for (const t of delRango) {
      if (t.tipo !== 'gasto') continue;
      porCategoria.set(t.id_categoria, (porCategoria.get(t.id_categoria) ?? 0) + t.monto);
      const grupo = categorias.find((c) => c.id_categoria === t.id_categoria)?.grupo ?? '';
      porGrupo.set(grupo, (porGrupo.get(grupo) ?? 0) + t.monto);
    }

    const por_categoria = Array.from(porCategoria.entries())
      .map(([id_categoria, total]) => {
        const categoria = categorias.find((c) => c.id_categoria === id_categoria);
        return {
          id_categoria,
          nombre: categoria?.nombre ?? 'Sin categoría',
          icono: categoria?.icono ?? '',
          color: categoria?.color ?? '#86868B',
          grupo: categoria?.grupo ?? '',
          total,
          proporcion: gastos > 0 ? total / gastos : 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    const por_grupo = Array.from(porGrupo.entries())
      .map(([grupo, total]) => ({ grupo, total, proporcion: gastos > 0 ? total / gastos : 0 }))
      .sort((a, b) => b.total - a.total);

    return { desde, hasta, ingresos, gastos, saldo: ingresos - gastos, por_categoria, por_grupo };
  }, [desde, hasta]);
}

/**
 * Cuántas veces se usó cada categoría en los últimos `dias` días (por tipo, espacio activo).
 * Ordena la rueda de categorías y la grilla de la hoja de registro: lo más usado primero.
 */
export function useUsoCategorias(tipo: TipoMovimiento, dias = 90): Record<string, number> | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const corte = new Date();
    corte.setDate(corte.getDate() - dias);
    const corteYmd = `${corte.getFullYear()}-${String(corte.getMonth() + 1).padStart(2, '0')}-${String(corte.getDate()).padStart(2, '0')}`;
    const uso: Record<string, number> = {};
    for (const t of await db.transacciones.toArray()) {
      if (t.eliminado || t.id_espacio !== idEspacio || t.tipo !== tipo || t.fecha < corteYmd) continue;
      uso[t.id_categoria] = (uso[t.id_categoria] ?? 0) + 1;
    }
    return uso;
  }, [tipo, dias]);
}

// ---------------------------------------------------------------------------------------------
// Sugerencias de la rueda de categorías (data/sugerencias.ts es la lógica pura).

import { porPagarPronto, sugerenciasPara, normalizar as normalizarNombre, type Sugerencia } from './sugerencias';

function hoyLocalYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Qué proponer al tocar estas categorías (una, o todas las de un grupo): lo que se debe y vence,
 * trabajadores, lo ya pagado antes y plantillas. Todo del espacio activo y solo lo vigente.
 */
export function useSugerencias(idsCategorias: string[]): Sugerencia[] | undefined {
  const clave = idsCategorias.join('|');
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const ids = new Set(clave ? clave.split('|') : []);
    const [cats, trans, deudas, obligaciones, trabajadores] = await Promise.all([
      db.categorias.toArray(),
      db.transacciones.toArray(),
      db.deudas.toArray(),
      db.obligaciones.toArray(),
      db.trabajadores.where('id_espacio').equals(idEspacio).toArray(),
    ]);
    const categorias = cats
      .filter((c) => c.activo && c.id_espacio === idEspacio && ids.has(c.id_categoria))
      .sort((a, b) => a.orden - b.orden);
    return sugerenciasPara({
      categorias,
      transacciones: trans.filter((t) => !t.eliminado && t.id_espacio === idEspacio),
      deudas: deudas.filter((d) => !d.eliminado && d.id_espacio === idEspacio),
      obligaciones: obligaciones.filter((o) => !o.eliminado && o.id_espacio === idEspacio),
      trabajadores,
      hoy: hoyLocalYmd(),
    });
  }, [clave]);
}

export interface PorPagar {
  deuda: Deuda;
  /** Días hasta el vencimiento (negativo = vencida). */
  dias: number;
  /** Categoría con la que queda registrado el gasto al pagar. */
  id_categoria: string;
}

/** Lo que se debe y vence en `dias` días o ya venció, en el espacio activo, con su categoría de pago. */
export function usePorPagarPronto(dias = 7): PorPagar[] | undefined {
  return useLiveQuery(async () => {
    const idEspacio = await getEspacioActivoId();
    const [cats, deudas, obligaciones] = await Promise.all([db.categorias.toArray(), db.deudas.toArray(), db.obligaciones.toArray()]);
    const categorias = cats.filter((c) => c.activo && c.id_espacio === idEspacio && c.tipo === 'gasto').sort((a, b) => a.orden - b.orden);
    const obls = obligaciones.filter((o) => !o.eliminado && o.id_espacio === idEspacio);
    const porNombre = (n: string) => categorias.find((c) => normalizarNombre(c.nombre) === n)?.id_categoria;
    const respaldo = categorias.find((c) => normalizarNombre(c.nombre).startsWith('otro'))?.id_categoria ?? categorias[0]?.id_categoria ?? '';

    const lista = porPagarPronto(
      deudas.filter((d) => !d.eliminado && d.id_espacio === idEspacio),
      hoyLocalYmd(),
      dias,
    );
    return lista.map(({ deuda, dias: d }) => {
      let id_categoria = '';
      if (deuda.id_prestamo) id_categoria = porNombre('amortizacion de prestamos') ?? porNombre('intereses y comisiones bancarias') ?? '';
      else if (deuda.descripcion.startsWith('Obligación mensual:')) {
        const concepto = deuda.descripcion.slice('Obligación mensual:'.length).trim();
        id_categoria = obls.find((o) => o.concepto === concepto)?.id_categoria ?? '';
      }
      if (!id_categoria && /sunat/i.test(deuda.persona + ' ' + deuda.descripcion)) id_categoria = porNombre('impuestos y sunat') ?? '';
      return { deuda, dias: d, id_categoria: id_categoria || respaldo };
    });
  }, [dias]);
}

// ---------------------------------------------------------------------------------------------
// Préstamos de cuota fija y cierre de préstamos.

export interface NuevoPrestamoCuotaFija {
  entidad: string;
  descripcion: string;
  cuota_mensual: number;
  dia_pago: number;
  /** 'yyyy-MM-dd' de la próxima cuota a pagar (la que se ve hoy en el banco). */
  proximo_vencimiento: string;
  id_cuenta: string;
  notas?: string;
}

/**
 * Préstamo del que solo se sabe la cuota y el día (no hay cronograma a mano). Crea la cuota que
 * está pendiente hoy; desde el mes siguiente el servidor genera una por mes (obligación enlazada)
 * hasta que se finaliza. El desglose capital/interés queda por completar.
 */
export async function crearPrestamoCuotaFija(d: NuevoPrestamoCuotaFija): Promise<void> {
  const idEspacio = await getEspacioActivoId();
  const id_prestamo = `PRS_${crypto.randomUUID().split('-')[0]}`;
  const momento = ahora();
  const base: Prestamo = {
    id_prestamo,
    id_espacio: idEspacio,
    entidad: d.entidad,
    tipo: 'prestamo',
    descripcion: d.descripcion,
    monto: 0,
    tea: 0,
    plazo: 0,
    dia_pago: d.dia_pago,
    fecha_desembolso: '',
    id_cuenta: d.id_cuenta,
    activo: true,
    notas: d.notas ?? '',
    fecha_creacion: momento,
    fecha_modificacion: momento,
    modalidad: 'cuota_fija',
    cuota_mensual: d.cuota_mensual,
    fecha_fin: '',
  };
  if (MODO_DEMO) {
    await db.prestamos.put(base);
  } else {
    requiereConexion();
    const { activo: _a, fecha_creacion: _c, fecha_modificacion: _m, ...payload } = base;
    await db.prestamos.put(await crearPrestamoRemoto({ ...payload, periodo_generado: d.proximo_vencimiento.slice(0, 7) }));
  }
  await crearDeuda({
    tipo: 'debo',
    persona: d.entidad,
    monto_original: d.cuota_mensual,
    descripcion: `${d.descripcion || 'Préstamo'} · cuota`,
    fecha_vencimiento: d.proximo_vencimiento,
    recordatorio: true,
    id_prestamo,
    notas: d.notas,
  });
}

/** "Ese fue el último pago". En demo se cierra localmente; en real lo hace el servidor. */
export async function finalizarPrestamo(id: string): Promise<void> {
  if (MODO_DEMO) {
    const hoy = ahora().slice(0, 10);
    await db.prestamos.update(id, { activo: false, fecha_fin: hoy, fecha_modificacion: ahora() });
    const futuras = (await db.deudas.where('id_prestamo').equals(id).toArray()).filter(
      (d) => !d.eliminado && d.estado !== 'pagada' && d.fecha_vencimiento > hoy,
    );
    for (const d of futuras) await db.deudas.update(d.id_deuda, { eliminado: true });
    return;
  }
  requiereConexion();
  await db.prestamos.put(await finalizarPrestamoRemoto(id));
  void sincronizarAhora();
}
