/**
 * 00_config.js — constantes, nombres de hoja, esquema de columnas y getProp().
 * No debe depender de ningún otro archivo del backend (se carga primero).
 */

// ==================== HOJAS ====================

var SHEETS = {
  USUARIOS: 'Usuarios',
  ESPACIOS: 'Espacios',
  MIEMBROS_ESPACIO: 'MiembrosEspacio',
  CUENTAS: 'Cuentas',
  CATEGORIAS: 'Categorias',
  TRANSACCIONES: 'Transacciones',
  EVIDENCIAS: 'Evidencias',
  DEUDAS: 'Deudas',
  PAGOS_DEUDA: 'PagosDeuda',
  TRANSFERENCIAS: 'Transferencias',
  PRESUPUESTOS: 'Presupuestos',
  OPERACIONES_APLICADAS: 'OperacionesAplicadas',
  GASTOS_RECURRENTES: 'GastosRecurrentes',
  ETIQUETAS: 'Etiquetas',
  TRANSACCION_ETIQUETAS: 'TransaccionEtiquetas',
  NOTIFICACIONES: 'Notificaciones',
  SOLICITUDES_DINERO: 'SolicitudesDinero',
  OBLIGACIONES_MENSUALES: 'ObligacionesMensuales'
};

// Esquema de columnas exacto — docs/CONTRACT.md § 2. El orden importa.
var ESQUEMA_COLUMNAS = {};
ESQUEMA_COLUMNAS[SHEETS.USUARIOS] = ['id_usuario', 'email', 'nombre', 'foto_perfil', 'google_id', 'telegram_chat_id', 'rol_global', 'moneda_principal', 'fecha_registro', 'ultima_sesion', 'activo'];
ESQUEMA_COLUMNAS[SHEETS.ESPACIOS] = ['id_espacio', 'nombre', 'descripcion', 'id_propietario', 'icono', 'color', 'fecha_creacion', 'activo'];
ESQUEMA_COLUMNAS[SHEETS.MIEMBROS_ESPACIO] = ['id_miembro', 'id_espacio', 'id_usuario', 'rol', 'fecha_union', 'activo'];
ESQUEMA_COLUMNAS[SHEETS.CUENTAS] = ['id_cuenta', 'id_espacio', 'nombre', 'tipo', 'saldo_inicial', 'moneda', 'color', 'icono', 'incluir_total', 'orden', 'activo', 'fecha_creacion'];
ESQUEMA_COLUMNAS[SHEETS.CATEGORIAS] = ['id_categoria', 'id_espacio', 'nombre', 'tipo', 'icono', 'color', 'es_sistema', 'grupo', 'orden', 'activo'];
ESQUEMA_COLUMNAS[SHEETS.TRANSACCIONES] = ['id_transaccion', 'id_espacio', 'id_usuario', 'id_cuenta', 'id_categoria', 'tipo', 'monto', 'descripcion', 'fecha', 'hora', 'ubicacion', 'notas', 'rev', 'origen', 'eliminado', 'fecha_creacion', 'fecha_modificacion'];
ESQUEMA_COLUMNAS[SHEETS.EVIDENCIAS] = ['id_evidencia', 'id_transaccion', 'tipo', 'url', 'nombre_archivo', 'tamano', 'fecha_subida'];
ESQUEMA_COLUMNAS[SHEETS.DEUDAS] = ['id_deuda', 'id_espacio', 'id_usuario', 'tipo', 'persona', 'monto_original', 'monto_pendiente', 'descripcion', 'fecha_creacion', 'fecha_vencimiento', 'estado', 'recordatorio', 'notas', 'rev', 'origen', 'eliminado', 'fecha_modificacion'];
ESQUEMA_COLUMNAS[SHEETS.PAGOS_DEUDA] = ['id_pago', 'id_deuda', 'monto', 'fecha', 'notas', 'id_transaccion'];
ESQUEMA_COLUMNAS[SHEETS.TRANSFERENCIAS] = ['id_transferencia', 'id_espacio', 'id_usuario', 'cuenta_origen', 'cuenta_destino', 'monto', 'fecha', 'nota'];
ESQUEMA_COLUMNAS[SHEETS.PRESUPUESTOS] = ['id_presupuesto', 'id_espacio', 'id_categoria', 'monto_limite', 'mes', 'anio', 'alerta_porcentaje', 'activo', 'rev', 'origen', 'eliminado', 'fecha_modificacion'];
ESQUEMA_COLUMNAS[SHEETS.OPERACIONES_APLICADAS] = ['op_id', 'id_registro', 'rev', 'resultado', 'fecha'];
ESQUEMA_COLUMNAS[SHEETS.GASTOS_RECURRENTES] = ['id_gasto_recurrente', 'id_espacio', 'id_categoria', 'id_cuenta', 'descripcion', 'monto', 'frecuencia', 'dia_ejecucion', 'proximo_ejecucion', 'activo', 'fecha_creacion'];
ESQUEMA_COLUMNAS[SHEETS.ETIQUETAS] = ['id_etiqueta', 'id_espacio', 'nombre', 'color'];
ESQUEMA_COLUMNAS[SHEETS.TRANSACCION_ETIQUETAS] = ['id', 'id_transaccion', 'id_etiqueta'];
ESQUEMA_COLUMNAS[SHEETS.NOTIFICACIONES] = ['id_notificacion', 'id_usuario', 'tipo', 'titulo', 'mensaje', 'datos', 'canal', 'leida', 'fecha_creacion'];
// Las dos hojas siguientes las consume backend/23_solicitudes.js y backend/24_obligaciones.js
// (otro agente, en paralelo); el esquema vive acá porque 00_config.js es el único dueño de
// SHEETS/ESQUEMA_COLUMNAS. No son entidades sincronizables (docs/CONTRACT.md § 2): sin rev
// propio, no entran en ENTIDADES_SYNC ni en el lote de `sincronizar`.
ESQUEMA_COLUMNAS[SHEETS.SOLICITUDES_DINERO] = ['id_solicitud', 'id_espacio', 'id_solicitante', 'monto', 'motivo', 'id_categoria', 'estado', 'id_aprobador', 'fecha_solicitud', 'fecha_respuesta', 'id_transaccion', 'notas', 'eliminado', 'fecha_modificacion'];
ESQUEMA_COLUMNAS[SHEETS.OBLIGACIONES_MENSUALES] = ['id_obligacion', 'id_espacio', 'concepto', 'id_categoria', 'id_cuenta', 'monto_estimado', 'dia_vencimiento', 'ultimo_periodo_generado', 'activo', 'notas', 'fecha_creacion', 'eliminado', 'fecha_modificacion'];

// Entidades sincronizables (control de revisiones, § 4 del contrato).
var ENTIDADES_SYNC = {
  transaccion: { hoja: SHEETS.TRANSACCIONES, idCampo: 'id_transaccion', prefijo: 'TRX' },
  deuda: { hoja: SHEETS.DEUDAS, idCampo: 'id_deuda', prefijo: 'DDA' },
  presupuesto: { hoja: SHEETS.PRESUPUESTOS, idCampo: 'id_presupuesto', prefijo: 'PRE' }
};

// Dos espacios compartidos por todo el grupo (decisión cerrada § 0.3 del contrato).
// ESPACIO_COMPARTIDO_ID YA NO EXISTE como constante única: todo endpoint de dominio
// recibe `id_espacio` explícito y el router valida membresía (03_auth.js `requiereMiembro`).
var ESP_FAMILIA_ID = 'ESP_FAMILIA';
var ESP_TELCOM_ID = 'ESP_TELCOM';

var ESPACIOS_POR_DEFECTO = [
  { id: ESP_FAMILIA_ID, nombre: 'Familia', descripcion: 'Gastos e ingresos de la casa', icono: '🏠', color: '#0A84FF' },
  { id: ESP_TELCOM_ID, nombre: 'Telcom', descripcion: 'Gastos e ingresos de la empresa', icono: '🏢', color: '#FF9F0A' }
];

// Categorías de sistema por espacio — docs/CONTRACT.md § 6-bis. es_sistema = true,
// no editables ni eliminables. `grupo` agrupa visualmente (vacío en Familia: con 11
// categorías no hace falta agrupar; Telcom sí lo necesita con 20+).
var CATEGORIAS_SISTEMA = {};

CATEGORIAS_SISTEMA[ESP_FAMILIA_ID] = {
  gasto: [
    { nombre: 'Comida', icono: '🍴', color: '#FF453A', grupo: '' },
    { nombre: 'Transporte', icono: '🚗', color: '#FF9F0A', grupo: '' },
    { nombre: 'Gastos fijos', icono: '📌', color: '#8E8E93', grupo: '' },
    { nombre: 'Servicios', icono: '💡', color: '#5E5CE6', grupo: '' },
    { nombre: 'Salud', icono: '🏥', color: '#FF375F', grupo: '' },
    { nombre: 'Educación', icono: '📚', color: '#0A84FF', grupo: '' },
    { nombre: 'Entretenimiento', icono: '🎬', color: '#BF5AF2', grupo: '' },
    { nombre: 'Otros gastos', icono: '📦', color: '#86868B', grupo: '' }
  ],
  ingreso: [
    { nombre: 'Sueldo', icono: '💼', color: '#30D158', grupo: '' },
    { nombre: 'Ingresos extra', icono: '➕', color: '#64D2FF', grupo: '' },
    { nombre: 'Otros ingresos', icono: '💰', color: '#98D45F', grupo: '' }
  ]
};

CATEGORIAS_SISTEMA[ESP_TELCOM_ID] = {
  gasto: [
    // grupo: operativos
    { nombre: 'Notaría y trámites', icono: '📜', color: '#FF9F0A', grupo: 'operativos' },
    { nombre: 'Servicios técnicos', icono: '🛠️', color: '#5E5CE6', grupo: 'operativos' },
    { nombre: 'Viáticos', icono: '🧳', color: '#64D2FF', grupo: 'operativos' },
    { nombre: 'Pasajes y transporte', icono: '🚕', color: '#0A84FF', grupo: 'operativos' },
    { nombre: 'Materiales de trabajo', icono: '🧰', color: '#FF9F0A', grupo: 'operativos' },
    { nombre: 'Combustible', icono: '⛽', color: '#FF453A', grupo: 'operativos' },
    { nombre: 'Alquiler de oficina', icono: '🏢', color: '#8E8E93', grupo: 'operativos' },
    { nombre: 'Servicios de oficina', icono: '💡', color: '#5E5CE6', grupo: 'operativos' },
    // grupo: personal
    { nombre: 'Sueldos y honorarios', icono: '💼', color: '#30D158', grupo: 'personal' },
    { nombre: 'Facturas de trabajadores', icono: '🧾', color: '#64D2FF', grupo: 'personal' },
    { nombre: 'Adelantos', icono: '➕', color: '#FF9F0A', grupo: 'personal' },
    { nombre: 'CTS', icono: '🏦', color: '#0A84FF', grupo: 'personal' },
    { nombre: 'EsSalud', icono: '🏥', color: '#FF375F', grupo: 'personal' },
    { nombre: 'Seguros', icono: '🛡️', color: '#5E5CE6', grupo: 'personal' },
    { nombre: 'Gratificaciones', icono: '🎁', color: '#BF5AF2', grupo: 'personal' },
    // grupo: activos
    { nombre: 'Muebles y enseres', icono: '🪑', color: '#8E8E93', grupo: 'activos' },
    { nombre: 'Equipos de cómputo', icono: '💻', color: '#0A84FF', grupo: 'activos' },
    { nombre: 'Útiles de oficina', icono: '📎', color: '#64D2FF', grupo: 'activos' },
    // grupo: impuestos
    { nombre: 'Impuestos y SUNAT', icono: '🏛️', color: '#FF453A', grupo: 'impuestos' },
    // sin grupo
    { nombre: 'Otros gastos operativos', icono: '📦', color: '#86868B', grupo: '' }
  ],
  ingreso: [
    { nombre: 'Servicios facturados', icono: '🧾', color: '#30D158', grupo: 'ingresos' },
    { nombre: 'Otros ingresos', icono: '💰', color: '#98D45F', grupo: 'ingresos' }
  ]
};

// Cuentas por defecto al inicializar cada espacio. El README no fija una lista;
// se reutiliza la del legacy (docs/Code.legacy.gs, crearCuentasPorDefecto) para
// ambos espacios: no hay ninguna decisión cerrada que las diferencie por espacio.
var CUENTAS_POR_DEFECTO = [
  { nombre: 'Efectivo', tipo: 'efectivo', icono: '💵', color: '#30D158' },
  { nombre: 'Cuenta bancaria', tipo: 'banco', icono: '🏦', color: '#0A84FF' },
  { nombre: 'Tarjeta de crédito', tipo: 'tarjeta', icono: '💳', color: '#FF9F0A' }
];

// ==================== PROPIEDADES DEL SCRIPT ====================

var _cacheProps = {};

/**
 * Lee una propiedad del script con caché en memoria para la ejecución actual.
 * Lanza un error claro si falta — nunca hardcodear secretos en el código fuente.
 */
function getProp(clave) {
  if (_cacheProps[clave] !== undefined) return _cacheProps[clave];
  var valor = PropertiesService.getScriptProperties().getProperty(clave);
  if (!valor) {
    throw new Error('Falta configurar la propiedad "' + clave + '" en PropertiesService (docs/CONTRACT.md § 7).');
  }
  _cacheProps[clave] = valor;
  return valor;
}

if (typeof module !== 'undefined') {
  module.exports = {
    SHEETS: SHEETS,
    ESQUEMA_COLUMNAS: ESQUEMA_COLUMNAS,
    ENTIDADES_SYNC: ENTIDADES_SYNC,
    ESP_FAMILIA_ID: ESP_FAMILIA_ID,
    ESP_TELCOM_ID: ESP_TELCOM_ID,
    ESPACIOS_POR_DEFECTO: ESPACIOS_POR_DEFECTO,
    CATEGORIAS_SISTEMA: CATEGORIAS_SISTEMA,
    CUENTAS_POR_DEFECTO: CUENTAS_POR_DEFECTO
  };
}
