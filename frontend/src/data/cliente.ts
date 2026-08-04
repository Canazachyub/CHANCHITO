/**
 * Único punto de contacto con el Web App de Apps Script (CONTRACT § 3 y § 4).
 *
 * Particularidades de Apps Script que hay que respetar sí o sí:
 * - El Web App responde con un 302 antes de llegar al JSON real → `redirect: 'follow'`.
 * - Apps Script no maneja bien el preflight OPTIONS de CORS. Si mandamos
 *   `Content-Type: application/json` el navegador dispara preflight y falla.
 *   Truco estándar: `text/plain;charset=utf-8`, con el JSON igual como body de texto.
 *   Apps Script lo parsea igual desde `e.postData.contents`.
 * - `action` siempre va como parámetro de URL, nunca en el body, tanto en GET como en POST.
 */
import type {
  Categoria,
  Cuenta,
  Deuda,
  Espacio,
  EstadoSolicitud,
  ObligacionMensual,
  Presupuesto,
  SolicitudDinero,
  Transaccion,
  Usuario,
} from './types';
import { cerrarSesion, getSesion } from '../offline/sesion';
import type { EntidadSincronizable, TipoOperacion } from '../offline/db';

const API_URL = import.meta.env.VITE_API_URL;
const SHARED_TOKEN = import.meta.env.VITE_SHARED_TOKEN;

/** Error de la API con el código normativo de CONTRACT § 3 (ej. 'MONTO_INVALIDO', 'CONFLICTO_REV'). */
export class ErrorApi extends Error {
  constructor(
    public codigo: string,
    public detalle?: string,
  ) {
    super(detalle ?? codigo);
    this.name = 'ErrorApi';
  }
}

interface RespuestaExito<T> {
  success: true;
  data: T;
}
interface RespuestaError {
  success: false;
  error: string;
  detalle?: string;
}
type RespuestaApi<T> = RespuestaExito<T> | RespuestaError;

function construirUrl(action: string, extra?: Record<string, string>): string {
  if (!API_URL) throw new Error('VITE_API_URL no está configurada (ver frontend/.env.example)');
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', SHARED_TOKEN ?? '');
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * POST genérico a una acción del Web App. `conSesion` agrega `sesion=<token_sesion>` a la URL
 * (todas las acciones de datos la requieren; `login` es la única excepción).
 */
async function postAction<T>(action: string, body: unknown, conSesion = true): Promise<T> {
  const extra: Record<string, string> = {};
  if (conSesion) {
    const sesion = await getSesion();
    if (sesion) extra.sesion = sesion.token_sesion;
  }

  const respuesta = await fetch(construirUrl(action, extra), {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body ?? {}),
  });

  if (!respuesta.ok) {
    throw new ErrorApi('ERROR_INTERNO', `HTTP ${respuesta.status}`);
  }

  const json = (await respuesta.json()) as RespuestaApi<T>;
  if (!json.success) {
    if (json.error === 'SESION_INVALIDA') {
      // La UI no vuelve a intentar con una sesión muerta: se limpia y App.tsx manda a Login sola
      // porque `onSesionChange(null)` dispara el `setSesion(null)` de App.tsx.
      await cerrarSesion();
    }
    throw new ErrorApi(json.error, json.detalle);
  }
  return json.data;
}

/** GET genérico a una acción de lectura del Web App (CONTRACT § 3, "Acciones GET"). */
async function getAction<T>(action: string, params?: Record<string, string>): Promise<T> {
  const extra: Record<string, string> = { ...(params ?? {}) };
  const sesion = await getSesion();
  if (sesion) extra.sesion = sesion.token_sesion;

  const respuesta = await fetch(construirUrl(action, extra), { method: 'GET', redirect: 'follow' });
  if (!respuesta.ok) {
    throw new ErrorApi('ERROR_INTERNO', `HTTP ${respuesta.status}`);
  }

  const json = (await respuesta.json()) as RespuestaApi<T>;
  if (!json.success) {
    if (json.error === 'SESION_INVALIDA') await cerrarSesion();
    throw new ErrorApi(json.error, json.detalle);
  }
  return json.data;
}

// ---------------------------------------------------------------------------------------------
// Sesión

export interface DatosLogin {
  usuario: Usuario;
  token_sesion: string;
  expira: string;
}

export async function login(idTokenGoogle: string): Promise<DatosLogin> {
  return postAction<DatosLogin>('login', { id_token: idTokenGoogle }, false);
}

// ---------------------------------------------------------------------------------------------
// Sincronización (CONTRACT § 4)

export interface OperacionEnvio {
  op_id: string;
  tipo: TipoOperacion;
  entidad: EntidadSincronizable;
  id: string;
  rev_base: number | null;
  datos: Record<string, unknown>;
}

export interface ResultadoOperacion {
  op_id: string;
  estado: 'aplicado' | 'conflicto' | 'rechazado';
  id?: string;
  rev?: number;
  version_servidor?: Record<string, unknown>;
  version_cliente?: Record<string, unknown>;
  error?: string;
  detalle?: string;
}

export interface CambiosServidor {
  transacciones: Transaccion[];
  deudas: Deuda[];
  presupuestos: Presupuesto[];
  categorias: Categoria[];
  cuentas: Cuenta[];
  usuarios: Usuario[];
}

export interface RespuestaSincronizar {
  resultados: ResultadoOperacion[];
  cambios: CambiosServidor;
  servidor_ts: string;
}

/**
 * `idEspacio` va a nivel de lote y es obligatorio (CONTRACT § 4): el servidor lo usa para
 * acotar los `cambios` que devuelve, para rechazar operaciones sobre registros de otro
 * espacio, y para forzar el `id_espacio` de las creaciones ignorando el que mande el cliente.
 * Se sincroniza un espacio por vez.
 */
export async function sincronizar(
  idEspacio: string,
  desde: string | null,
  operaciones: OperacionEnvio[],
): Promise<RespuestaSincronizar> {
  return postAction<RespuestaSincronizar>('sincronizar', { id_espacio: idEspacio, desde, operaciones });
}

// ---------------------------------------------------------------------------------------------
// Administración de usuarios
//
// `usuario` no está en la lista de entidades del endpoint `sincronizar` (CONTRACT § 4 solo
// contempla transaccion/deuda/presupuesto), así que alta/baja de usuarios no pasa por la cola
// offline: son acciones de administración que requieren conexión, con efecto inmediato.
// TODO(contrato): el contrato no aclara si crearUsuario/desactivarUsuario deberían poder
// encolarse offline; se asume que no, dado que ni siquiera están en `cambios` como algo que
// el cliente pueda "proponer" — solo recibirlas ya confirmadas.

export async function crearUsuarioRemoto(u: { nombre: string; email: string }): Promise<Usuario> {
  return postAction<Usuario>('crearUsuario', u);
}

export async function desactivarUsuarioRemoto(idUsuario: string): Promise<void> {
  await postAction<void>('desactivarUsuario', { id_usuario: idUsuario });
}

// ---------------------------------------------------------------------------------------------
// Espacios (CONTRACT § 0.3). Solo lectura desde este agente: `actualizarEspacio` es de
// Administración y no está en el alcance de esta entrega.

export async function getEspaciosRemoto(): Promise<Espacio[]> {
  return getAction<Espacio[]>('getEspacios');
}

// ---------------------------------------------------------------------------------------------
// Solicitudes de dinero (CONTRACT § 4-bis). No pasan por `sincronizar`: exigen conexión,
// así que cada acción es un POST/GET directo, sin pasar por la cola offline.

export async function getSolicitudesRemoto(idEspacio: string, estado?: EstadoSolicitud): Promise<SolicitudDinero[]> {
  const params: Record<string, string> = { id_espacio: idEspacio };
  if (estado) params.estado = estado;
  return getAction<SolicitudDinero[]>('getSolicitudes', params);
}

export interface PayloadCrearSolicitud {
  id_espacio: string;
  id_solicitante: string;
  monto: number;
  motivo: string;
  id_categoria: string;
}

export async function crearSolicitudRemota(p: PayloadCrearSolicitud): Promise<SolicitudDinero> {
  return postAction<SolicitudDinero>('crearSolicitud', p);
}

/** Solo propietario (CONTRACT § 4-bis, § 6). Aprobar crea de una vez la transacción de gasto. */
export async function responderSolicitudRemota(
  idSolicitud: string,
  aprobar: boolean,
  motivo?: string,
): Promise<SolicitudDinero> {
  return postAction<SolicitudDinero>('responderSolicitud', {
    id_solicitud: idSolicitud,
    aprobar,
    motivo: motivo ?? '',
  });
}

// ---------------------------------------------------------------------------------------------
// Obligaciones mensuales (CONTRACT § 4-ter). Igual que Solicitudes: exigen conexión, sin cola.

export async function getObligacionesRemoto(idEspacio: string): Promise<ObligacionMensual[]> {
  return getAction<ObligacionMensual[]>('getObligaciones', { id_espacio: idEspacio });
}

export interface PayloadCrearObligacion {
  id_espacio: string;
  concepto: string;
  id_categoria: string;
  id_cuenta: string;
  monto_estimado: number;
  dia_vencimiento: number;
  notas?: string;
}

/** Las tres de escritura son solo para el propietario (CONTRACT § 4-ter). */
export async function crearObligacionRemota(p: PayloadCrearObligacion): Promise<ObligacionMensual> {
  return postAction<ObligacionMensual>('crearObligacion', p);
}

export async function actualizarObligacionRemota(
  id: string,
  cambios: Partial<ObligacionMensual>,
): Promise<ObligacionMensual> {
  return postAction<ObligacionMensual>('actualizarObligacion', { id_obligacion: id, ...cambios });
}

/** Baja lógica: `activo = false` (CONTRACT § 4-ter), deja intactas las deudas ya generadas. */
export async function eliminarObligacionRemota(id: string): Promise<void> {
  await postAction<void>('eliminarObligacion', { id_obligacion: id });
}
