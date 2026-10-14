/**
 * Tipos compartidos entre la UI y la capa de datos.
 * Espejo exacto de las columnas de Sheets (docs/CONTRACT.md § 2).
 * Los nombres van en snake_case a propósito: son los mismos que viajan por la API.
 */

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'rechazado';
export type Origen = 'app' | 'bot_texto' | 'bot_foto' | 'migracion';
export type TipoMovimiento = 'gasto' | 'ingreso';
export type RolGlobal = 'propietario' | 'miembro';

export interface Usuario {
  id_usuario: string;
  email: string;
  nombre: string;
  foto_perfil: string;
  google_id: string;
  telegram_chat_id: string;
  rol_global: RolGlobal;
  moneda_principal: string;
  fecha_registro: string;
  ultima_sesion: string;
  activo: boolean;
  /** Nombre de usuario para entrar con contraseña (CONTRACT § 0.1-bis). Vacío si solo usa Google. */
  usuario?: string;
  /** El servidor nunca manda el hash: solo si existe. */
  tiene_password?: boolean;
  /** Entró con una contraseña temporal: la app lo obliga a cambiarla antes de seguir. */
  debe_cambiar_password?: boolean;
}

export interface Categoria {
  id_categoria: string;
  id_espacio: string;
  nombre: string;
  tipo: TipoMovimiento;
  icono: string;
  color: string;
  es_sistema: boolean;
  /** Agrupador visual (CONTRACT § 2 / § 6-bis): '' en Familia, en Telcom uno de
   * 'operativos' | 'personal' | 'activos' | 'impuestos' | 'ingresos' (o '' para las sueltas). */
  grupo: string;
  orden: number;
  activo: boolean;
}

export interface Cuenta {
  id_cuenta: string;
  id_espacio: string;
  nombre: string;
  tipo: string;
  saldo_inicial: number;
  moneda: string;
  color: string;
  icono: string;
  incluir_total: boolean;
  orden: number;
  activo: boolean;
  fecha_creacion: string;
}

export interface Transaccion {
  id_transaccion: string;
  id_espacio: string;
  id_usuario: string;
  id_cuenta: string;
  id_categoria: string;
  tipo: TipoMovimiento;
  monto: number;
  descripcion: string;
  fecha: string;
  hora: string;
  ubicacion: string;
  notas: string;
  rev: number;
  origen: Origen;
  eliminado: boolean;
  fecha_creacion: string;
  fecha_modificacion: string;
  /** A qué trabajador se le pagó (CONTRACT § 4-quater). Vacío o ausente en filas viejas. */
  id_trabajador?: string;
  /** Solo local, no viaja al servidor. */
  sync_status: SyncStatus;
  /** rev que tenía el registro cuando empezó la edición offline. */
  rev_base?: number;
}

export type EstadoDeuda = 'pendiente' | 'pagada' | 'vencida';

export interface Deuda {
  id_deuda: string;
  id_espacio: string;
  id_usuario: string;
  tipo: 'me_deben' | 'debo';
  persona: string;
  monto_original: number;
  monto_pendiente: number;
  descripcion: string;
  fecha_creacion: string;
  fecha_vencimiento: string;
  estado: EstadoDeuda;
  recordatorio: boolean;
  notas: string;
  rev: number;
  origen: Origen;
  eliminado: boolean;
  /** Adelanto por descontar (me_deben) o planilla por pagar (debo) de un trabajador. */
  id_trabajador?: string;
  /** Cuota de un préstamo bancario (CONTRACT § 4-quinquies). */
  id_prestamo?: string;
  nro_cuota?: number;
  /** Desglose de la cuota: lo que baja la deuda vs. lo que cuesta el préstamo. */
  capital?: number;
  interes?: number;
  /** Seguro de desgravamen, comisiones, portes. */
  otros?: number;
  sync_status: SyncStatus;
  rev_base?: number;
}

export interface Presupuesto {
  id_presupuesto: string;
  id_espacio: string;
  id_categoria: string;
  monto_limite: number;
  mes: number;
  anio: number;
  alerta_porcentaje: number;
  activo: boolean;
  rev: number;
  origen: Origen;
  eliminado: boolean;
  sync_status: SyncStatus;
  rev_base?: number;
}

export interface Conflicto {
  id_conflicto: string;
  entidad: 'transaccion' | 'deuda' | 'presupuesto';
  id_registro: string;
  /**
   * 'conflicto': rev_base desactualizado, hay versión real del servidor para comparar.
   * 'rechazado': el servidor nunca aplicó la operación (ej. MONTO_INVALIDO); no hay
   * "versión del servidor" que mostrar, solo el motivo del rechazo (`error`/`detalle`).
   * Campo explícito a propósito — antes era un marcador `__rechazado` escondido dentro de
   * `version_servidor`, indistinguible de un campo de datos real.
   */
  estado: 'conflicto' | 'rechazado';
  version_cliente: Record<string, unknown>;
  version_servidor: Record<string, unknown>;
  /** Solo si estado === 'rechazado': código y detalle del error devuelto por el servidor. */
  error?: string;
  detalle?: string;
  fecha_detectado: string;
}

export interface ResumenMensual {
  mes: number;
  anio: number;
  total_ingresos: number;
  total_gastos: number;
  saldo: number;
  por_categoria: Array<{
    id_categoria: string;
    nombre: string;
    color: string;
    icono: string;
    total: number;
    /** 0..1 — fracción del total de gastos del mes; alimenta los anillos. */
    proporcion: number;
    /** Presente solo si la categoría tiene presupuesto ese mes. */
    limite?: number;
    /** Agrupador de la categoría (CONTRACT § 2 / § 6-bis). '' en Familia. */
    grupo: string;
  }>;
}

export interface Sesion {
  usuario: Usuario;
  token_sesion: string;
  expira: string;
}

/**
 * Espacio compartido (CONTRACT § 0.3): ESP_FAMILIA y ESP_TELCOM, no espacios personales.
 * Balances, categorías, presupuestos, deudas y obligaciones son por espacio y nunca se suman.
 */
export interface Espacio {
  id_espacio: string;
  nombre: string;
  descripcion: string;
  id_propietario: string;
  icono: string;
  color: string;
  fecha_creacion: string;
  activo: boolean;
}

/** CONTRACT § 4-bis. */
export type EstadoSolicitud = 'solicitada' | 'aprobada' | 'rechazada';

export interface SolicitudDinero {
  id_solicitud: string;
  id_espacio: string;
  id_solicitante: string;
  monto: number;
  motivo: string;
  id_categoria: string;
  estado: EstadoSolicitud;
  id_aprobador: string;
  fecha_solicitud: string;
  fecha_respuesta: string;
  /** Solo si estado === 'aprobada': la transacción de gasto que se creó al aprobar. */
  id_transaccion: string;
  notas: string;
  eliminado: boolean;
  fecha_modificacion: string;
}

/** CONTRACT § 4-ter. */
export interface ObligacionMensual {
  id_obligacion: string;
  id_espacio: string;
  concepto: string;
  id_categoria: string;
  id_cuenta: string;
  monto_estimado: number;
  dia_vencimiento: number;
  /** 'yyyy-MM' del último mes en que ya se generó la deuda, o '' si nunca. */
  ultimo_periodo_generado: string;
  activo: boolean;
  notas: string;
  fecha_creacion: string;
  eliminado: boolean;
  fecha_modificacion: string;
  /** Si es la planilla de una persona, la deuda que genera cada mes queda a su nombre. */
  id_trabajador?: string;
  /** Si genera las cuotas de un préstamo de cuota fija. */
  id_prestamo?: string;
}

/** CONTRACT § 4-quater. A quién se le paga; no es un usuario de la app. */
export type TipoVinculo = 'planilla' | 'honorarios';

export interface Trabajador {
  id_trabajador: string;
  id_espacio: string;
  nombre: string;
  documento: string;
  tipo_vinculo: TipoVinculo;
  cargo: string;
  /** Contrato u obra al que está asignado (ej. 'CP-026'). */
  proyecto: string;
  /** En honorarios por jornada es referencial. */
  sueldo_base: number;
  /** 'ONP', 'AFP Integra'... Vacío si no se sabe. */
  pension: string;
  /** 'yyyy-MM-dd' o '' si no hay dato. */
  fecha_ingreso: string;
  /** Fin del contrato o del tramo vigente. '' = indefinido. */
  fecha_fin: string;
  /** Si además usa la app. Vacío si no. */
  id_usuario: string;
  activo: boolean;
  notas: string;
  fecha_creacion: string;
  fecha_modificacion: string;
}

/** CONTRACT § 4-quinquies. Las cuotas viven como Deudas con `id_prestamo`. */
export type TipoPrestamo = 'prestamo' | 'tarjeta' | 'leasing' | 'otro';

export interface Prestamo {
  id_prestamo: string;
  id_espacio: string;
  /** Banco o financiera. */
  entidad: string;
  tipo: TipoPrestamo;
  descripcion: string;
  monto: number;
  /** TEA en porcentaje. */
  tea: number;
  plazo: number;
  dia_pago: number;
  fecha_desembolso: string;
  /** Cuenta de la que sale el pago de las cuotas. */
  id_cuenta: string;
  activo: boolean;
  notas: string;
  fecha_creacion: string;
  fecha_modificacion: string;
  /**
   * 'cronograma': se conocen monto, plazo y TEA (cuotas creadas de antemano).
   * 'cuota_fija': solo se sabe la cuota y el día; cada mes se genera la siguiente hasta finalizarlo.
   * Ausente en filas viejas = 'cronograma'.
   */
  modalidad?: 'cronograma' | 'cuota_fija';
  cuota_mensual?: number;
  /** Fecha en que se finalizó (último pago). Vacío mientras está vigente. */
  fecha_fin?: string;
}
