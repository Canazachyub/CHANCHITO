/**
 * CHANCHITO - API REST con Google Apps Script
 * Backend para aplicación de finanzas personales
 *
 * Configuración:
 * 1. Crear proyecto en Google Apps Script
 * 2. Copiar este código
 * 3. Configurar las constantes SPREADSHEET_ID y DRIVE_FOLDER_ID
 * 4. Implementar como aplicación web (Deploy > New deployment > Web app)
 * 5. Configurar acceso: "Anyone" para pruebas o "Anyone with Google account" para producción
 */

// ==================== CONFIGURACIÓN ====================
const SPREADSHEET_ID = 'TU_SPREADSHEET_ID';
const DRIVE_FOLDER_ID = 'TU_DRIVE_FOLDER_ID';

// Nombres de las hojas (tablas)
const SHEETS = {
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
  TRANSFERENCIAS_INTER_USUARIO: 'TransferenciasInterUsuario',
  PRESUPUESTOS: 'Presupuestos',
  GASTOS_RECURRENTES: 'GastosRecurrentes',
  ETIQUETAS: 'Etiquetas',
  TRANSACCION_ETIQUETAS: 'TransaccionEtiquetas',
  NOTIFICACIONES: 'Notificaciones'
};

// ==================== ENDPOINTS PRINCIPALES ====================

/**
 * Maneja peticiones GET
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    const params = e.parameter;

    let result;

    switch(action) {
      // Autenticación
      case 'login':
        result = login(params.email, params.google_id);
        break;
      case 'getUsuario':
        result = getUsuario(params.id_usuario);
        break;

      // Espacios
      case 'getEspacios':
        result = getEspaciosByUsuario(params.id_usuario);
        break;
      case 'getEspacio':
        result = getEspacio(params.id_espacio);
        break;
      case 'getMiembrosEspacio':
        result = getMiembrosEspacio(params.id_espacio);
        break;

      // Cuentas
      case 'getCuentas':
        result = getCuentas(params.id_espacio);
        break;
      case 'getCuenta':
        result = getCuenta(params.id_cuenta);
        break;
      case 'getBalanceCuenta':
        result = getBalanceCuenta(params.id_cuenta);
        break;

      // Categorías
      case 'getCategorias':
        result = getCategorias(params.id_espacio, params.tipo);
        break;
      case 'getCategoria':
        result = getCategoria(params.id_categoria);
        break;

      // Transacciones
      case 'getTransacciones':
        result = getTransacciones(params.id_espacio, params.fecha_inicio, params.fecha_fin, params.tipo, params.id_categoria, params.id_cuenta);
        break;
      case 'getTransaccion':
        result = getTransaccion(params.id_transaccion);
        break;
      case 'getTransaccionesHoy':
        result = getTransaccionesHoy(params.id_espacio);
        break;

      // Evidencias
      case 'getEvidencias':
        result = getEvidenciasByTransaccion(params.id_transaccion);
        break;

      // Deudas
      case 'getDeudas':
        result = getDeudas(params.id_espacio, params.tipo, params.estado);
        break;
      case 'getDeuda':
        result = getDeuda(params.id_deuda);
        break;
      case 'getPagosDeuda':
        result = getPagosDeuda(params.id_deuda);
        break;

      // Transferencias
      case 'getTransferencias':
        result = getTransferencias(params.id_espacio, params.fecha_inicio, params.fecha_fin);
        break;

      // Transferencias Inter-Usuario
      case 'buscarUsuarioPorEmail':
        result = buscarUsuarioPorEmail(params.email);
        break;
      case 'getCuentasDeEspacio':
        result = getCuentasDeEspacioPublico(params.id_espacio);
        break;
      case 'getTransferenciasInterUsuario':
        result = getTransferenciasInterUsuario(params.id_espacio);
        break;

      // Presupuestos
      case 'getPresupuestos':
        result = getPresupuestos(params.id_espacio, params.mes, params.anio);
        break;
      case 'getProgresoPresupuesto':
        result = getProgresoPresupuesto(params.id_presupuesto);
        break;

      // Gastos recurrentes
      case 'getGastosRecurrentes':
        result = getGastosRecurrentes(params.id_espacio);
        break;

      // Etiquetas
      case 'getEtiquetas':
        result = getEtiquetas(params.id_espacio);
        break;

      // Notificaciones
      case 'getNotificaciones':
        result = getNotificaciones(params.id_usuario, params.leida);
        break;

      // Dashboard
      case 'getDashboard':
        result = getDashboard(params.id_espacio, params.mes, params.anio);
        break;
      case 'getResumenMensual':
        result = getResumenMensual(params.id_espacio, params.mes, params.anio);
        break;
      case 'getTendencia':
        result = getTendencia(params.id_espacio, params.meses);
        break;
      case 'getTopCategorias':
        result = getTopCategorias(params.id_espacio, params.mes, params.anio, params.limite);
        break;

      // ===== ACCIONES DE ESCRITURA (también por GET para evitar problemas de redirect) =====

      // Usuarios
      case 'crearUsuario':
        result = crearUsuario(params);
        break;
      case 'actualizarUsuario':
        result = actualizarUsuario(params);
        break;

      // Espacios
      case 'crearEspacio':
        result = crearEspacio(params);
        break;
      case 'actualizarEspacio':
        result = actualizarEspacio(params);
        break;

      // Cuentas
      case 'crearCuenta':
        result = crearCuenta(params);
        break;
      case 'actualizarCuenta':
        result = actualizarCuenta(params);
        break;
      case 'eliminarCuenta':
        result = eliminarCuenta(params.id_cuenta);
        break;

      // Categorías
      case 'crearCategoria':
        result = crearCategoria(params);
        break;
      case 'actualizarCategoria':
        result = actualizarCategoria(params);
        break;
      case 'eliminarCategoria':
        result = eliminarCategoria(params.id_categoria);
        break;

      // Transacciones
      case 'crearTransaccion':
        result = crearTransaccion(params);
        break;
      case 'actualizarTransaccion':
        result = actualizarTransaccion(params);
        break;
      case 'eliminarTransaccion':
        result = eliminarTransaccion(params.id_transaccion);
        break;

      // Evidencias
      case 'subirEvidencia':
        result = subirEvidencia(params);
        break;
      case 'eliminarEvidencia':
        result = eliminarEvidencia(params.id_evidencia);
        break;

      // Deudas
      case 'crearDeuda':
        result = crearDeuda(params);
        break;
      case 'actualizarDeuda':
        result = actualizarDeuda(params);
        break;
      case 'eliminarDeuda':
        result = eliminarDeuda(params.id_deuda);
        break;
      case 'registrarPagoDeuda':
        result = registrarPagoDeuda(params);
        break;

      // Transferencias
      case 'realizarTransferencia':
        result = realizarTransferencia(params);
        break;

      // Transferencias Inter-Usuario
      case 'crearTransferenciaInterUsuario':
        result = crearTransferenciaInterUsuario(params);
        break;

      // Presupuestos
      case 'crearPresupuesto':
        result = crearPresupuesto(params);
        break;
      case 'actualizarPresupuesto':
        result = actualizarPresupuesto(params);
        break;
      case 'eliminarPresupuesto':
        result = eliminarPresupuesto(params.id_presupuesto);
        break;

      default:
        result = { success: false, error: 'Acción no válida: ' + action };
    }

    return jsonResponse(result);

  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

/**
 * Maneja peticiones POST
 */
function doPost(e) {
  try {
    // IMPORTANTE: La acción viene en el parámetro URL, no en el body
    const action = e.parameter.action;

    // El body contiene los datos del POST
    let data = {};

    // Intentar obtener datos del body primero
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (parseError) {
        // Si falla el parse del body, usar el parámetro data
        data = {};
      }
    }

    // Si data está vacío, intentar obtener del parámetro URL 'data'
    // Esto es un fallback para cuando el redirect pierde el body
    if (Object.keys(data).length === 0 && e.parameter.data) {
      try {
        data = JSON.parse(decodeURIComponent(e.parameter.data));
      } catch (urlParseError) {
        // Si también falla, dejar data vacío
      }
    }

    let result;

    switch(action) {
      // Usuarios
      case 'crearUsuario':
        result = crearUsuario(data);
        break;
      case 'actualizarUsuario':
        result = actualizarUsuario(data);
        break;

      // Espacios
      case 'crearEspacio':
        result = crearEspacio(data);
        break;
      case 'actualizarEspacio':
        result = actualizarEspacio(data);
        break;
      case 'agregarMiembro':
        result = agregarMiembroEspacio(data);
        break;
      case 'eliminarMiembro':
        result = eliminarMiembroEspacio(data.id_espacio, data.id_usuario);
        break;

      // Cuentas
      case 'crearCuenta':
        result = crearCuenta(data);
        break;
      case 'actualizarCuenta':
        result = actualizarCuenta(data);
        break;
      case 'eliminarCuenta':
        result = eliminarCuenta(data.id_cuenta);
        break;

      // Categorías
      case 'crearCategoria':
        result = crearCategoria(data);
        break;
      case 'actualizarCategoria':
        result = actualizarCategoria(data);
        break;
      case 'eliminarCategoria':
        result = eliminarCategoria(data.id_categoria);
        break;

      // Transacciones
      case 'crearTransaccion':
        result = crearTransaccion(data);
        break;
      case 'actualizarTransaccion':
        result = actualizarTransaccion(data);
        break;
      case 'eliminarTransaccion':
        result = eliminarTransaccion(data.id_transaccion);
        break;

      // Evidencias
      case 'subirEvidencia':
        result = subirEvidencia(data);
        break;
      case 'eliminarEvidencia':
        result = eliminarEvidencia(data.id_evidencia);
        break;

      // Deudas
      case 'crearDeuda':
        result = crearDeuda(data);
        break;
      case 'actualizarDeuda':
        result = actualizarDeuda(data);
        break;
      case 'eliminarDeuda':
        result = eliminarDeuda(data.id_deuda);
        break;
      case 'registrarPagoDeuda':
        result = registrarPagoDeuda(data);
        break;

      // Transferencias
      case 'realizarTransferencia':
        result = realizarTransferencia(data);
        break;

      // Presupuestos
      case 'crearPresupuesto':
        result = crearPresupuesto(data);
        break;
      case 'actualizarPresupuesto':
        result = actualizarPresupuesto(data);
        break;
      case 'eliminarPresupuesto':
        result = eliminarPresupuesto(data.id_presupuesto);
        break;

      // Gastos recurrentes
      case 'crearGastoRecurrente':
        result = crearGastoRecurrente(data);
        break;
      case 'actualizarGastoRecurrente':
        result = actualizarGastoRecurrente(data);
        break;
      case 'eliminarGastoRecurrente':
        result = eliminarGastoRecurrente(data.id_gasto_recurrente);
        break;
      case 'ejecutarGastoRecurrente':
        result = ejecutarGastoRecurrente(data.id_gasto_recurrente);
        break;

      // Etiquetas
      case 'crearEtiqueta':
        result = crearEtiqueta(data);
        break;
      case 'eliminarEtiqueta':
        result = eliminarEtiqueta(data.id_etiqueta);
        break;
      case 'asignarEtiqueta':
        result = asignarEtiqueta(data.id_transaccion, data.id_etiqueta);
        break;
      case 'removerEtiqueta':
        result = removerEtiqueta(data.id_transaccion, data.id_etiqueta);
        break;

      // Notificaciones
      case 'crearNotificacion':
        result = crearNotificacion(data);
        break;
      case 'marcarNotificacionLeida':
        result = marcarNotificacionLeida(data.id_notificacion);
        break;
      case 'marcarTodasLeidas':
        result = marcarTodasNotificacionesLeidas(data.id_usuario);
        break;

      default:
        result = { success: false, error: 'Acción no válida: ' + action };
    }

    return jsonResponse(result);

  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

// ==================== UTILIDADES ====================

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // Agregar headers según la hoja
    addHeaders(sheet, name);
  }
  return sheet;
}

function addHeaders(sheet, name) {
  const headers = {
    [SHEETS.USUARIOS]: ['id_usuario', 'email', 'nombre', 'foto_perfil', 'google_id', 'moneda_principal', 'fecha_registro', 'ultima_sesion', 'activo'],
    [SHEETS.ESPACIOS]: ['id_espacio', 'nombre', 'descripcion', 'id_propietario', 'icono', 'color', 'fecha_creacion', 'activo'],
    [SHEETS.MIEMBROS_ESPACIO]: ['id_miembro', 'id_espacio', 'id_usuario', 'rol', 'fecha_union', 'activo'],
    [SHEETS.CUENTAS]: ['id_cuenta', 'id_espacio', 'nombre', 'tipo', 'saldo_inicial', 'moneda', 'color', 'icono', 'incluir_total', 'orden', 'activo', 'fecha_creacion'],
    [SHEETS.CATEGORIAS]: ['id_categoria', 'id_espacio', 'nombre', 'tipo', 'icono', 'color', 'es_sistema', 'orden', 'activo'],
    [SHEETS.TRANSACCIONES]: ['id_transaccion', 'id_espacio', 'id_usuario', 'id_cuenta', 'id_categoria', 'tipo', 'monto', 'descripcion', 'fecha', 'hora', 'ubicacion', 'notas', 'fecha_creacion', 'fecha_modificacion'],
    [SHEETS.EVIDENCIAS]: ['id_evidencia', 'id_transaccion', 'tipo', 'url', 'nombre_archivo', 'tamano', 'fecha_subida'],
    [SHEETS.DEUDAS]: ['id_deuda', 'id_espacio', 'id_usuario', 'tipo', 'persona', 'monto_original', 'monto_pendiente', 'descripcion', 'fecha_creacion', 'fecha_vencimiento', 'estado', 'recordatorio', 'notas'],
    [SHEETS.PAGOS_DEUDA]: ['id_pago', 'id_deuda', 'monto', 'fecha', 'notas', 'id_transaccion'],
    [SHEETS.TRANSFERENCIAS]: ['id_transferencia', 'id_espacio', 'id_usuario', 'cuenta_origen', 'cuenta_destino', 'monto', 'fecha', 'nota'],
    [SHEETS.TRANSFERENCIAS_INTER_USUARIO]: ['id_transferencia', 'id_espacio_origen', 'id_cuenta_origen', 'id_espacio_destino', 'id_cuenta_destino', 'monto', 'concepto', 'estado', 'fecha_solicitud', 'fecha_completada', 'creado_por'],
    [SHEETS.PRESUPUESTOS]: ['id_presupuesto', 'id_espacio', 'id_categoria', 'monto_limite', 'mes', 'anio', 'alerta_porcentaje', 'activo'],
    [SHEETS.GASTOS_RECURRENTES]: ['id_gasto_recurrente', 'id_espacio', 'id_categoria', 'id_cuenta', 'descripcion', 'monto', 'frecuencia', 'dia_ejecucion', 'proximo_ejecucion', 'activo', 'fecha_creacion'],
    [SHEETS.ETIQUETAS]: ['id_etiqueta', 'id_espacio', 'nombre', 'color'],
    [SHEETS.TRANSACCION_ETIQUETAS]: ['id', 'id_transaccion', 'id_etiqueta'],
    [SHEETS.NOTIFICACIONES]: ['id_notificacion', 'id_usuario', 'tipo', 'titulo', 'mensaje', 'datos', 'leida', 'fecha_creacion']
  };

  if (headers[name]) {
    sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
  }
}

/**
 * FUNCIÓN PARA INICIALIZAR TODAS LAS HOJAS
 * Ejecutar esta función una vez para crear todas las hojas con sus encabezados
 * Ir a: Ejecutar > Ejecutar función > inicializarHojas
 */
function inicializarHojas() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const headers = {
    [SHEETS.USUARIOS]: ['id_usuario', 'email', 'nombre', 'foto_perfil', 'google_id', 'moneda_principal', 'fecha_registro', 'ultima_sesion', 'activo'],
    [SHEETS.ESPACIOS]: ['id_espacio', 'nombre', 'descripcion', 'id_propietario', 'icono', 'color', 'fecha_creacion', 'activo'],
    [SHEETS.MIEMBROS_ESPACIO]: ['id_miembro', 'id_espacio', 'id_usuario', 'rol', 'fecha_union', 'activo'],
    [SHEETS.CUENTAS]: ['id_cuenta', 'id_espacio', 'nombre', 'tipo', 'saldo_inicial', 'moneda', 'color', 'icono', 'incluir_total', 'orden', 'activo', 'fecha_creacion'],
    [SHEETS.CATEGORIAS]: ['id_categoria', 'id_espacio', 'nombre', 'tipo', 'icono', 'color', 'es_sistema', 'orden', 'activo'],
    [SHEETS.TRANSACCIONES]: ['id_transaccion', 'id_espacio', 'id_usuario', 'id_cuenta', 'id_categoria', 'tipo', 'monto', 'descripcion', 'fecha', 'hora', 'ubicacion', 'notas', 'fecha_creacion', 'fecha_modificacion'],
    [SHEETS.EVIDENCIAS]: ['id_evidencia', 'id_transaccion', 'tipo', 'url', 'nombre_archivo', 'tamano', 'fecha_subida'],
    [SHEETS.DEUDAS]: ['id_deuda', 'id_espacio', 'id_usuario', 'tipo', 'persona', 'monto_original', 'monto_pendiente', 'descripcion', 'fecha_creacion', 'fecha_vencimiento', 'estado', 'recordatorio', 'notas'],
    [SHEETS.PAGOS_DEUDA]: ['id_pago', 'id_deuda', 'monto', 'fecha', 'notas', 'id_transaccion'],
    [SHEETS.TRANSFERENCIAS]: ['id_transferencia', 'id_espacio', 'id_usuario', 'cuenta_origen', 'cuenta_destino', 'monto', 'fecha', 'nota'],
    [SHEETS.TRANSFERENCIAS_INTER_USUARIO]: ['id_transferencia', 'id_espacio_origen', 'id_cuenta_origen', 'id_espacio_destino', 'id_cuenta_destino', 'monto', 'concepto', 'estado', 'fecha_solicitud', 'fecha_completada', 'creado_por'],
    [SHEETS.PRESUPUESTOS]: ['id_presupuesto', 'id_espacio', 'id_categoria', 'monto_limite', 'mes', 'anio', 'alerta_porcentaje', 'activo'],
    [SHEETS.GASTOS_RECURRENTES]: ['id_gasto_recurrente', 'id_espacio', 'id_categoria', 'id_cuenta', 'descripcion', 'monto', 'frecuencia', 'dia_ejecucion', 'proximo_ejecucion', 'activo', 'fecha_creacion'],
    [SHEETS.ETIQUETAS]: ['id_etiqueta', 'id_espacio', 'nombre', 'color'],
    [SHEETS.TRANSACCION_ETIQUETAS]: ['id', 'id_transaccion', 'id_etiqueta'],
    [SHEETS.NOTIFICACIONES]: ['id_notificacion', 'id_usuario', 'tipo', 'titulo', 'mensaje', 'datos', 'leida', 'fecha_creacion']
  };

  const creadas = [];
  const existentes = [];

  // Crear cada hoja
  for (const sheetName of Object.values(SHEETS)) {
    let sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      // Crear nueva hoja
      sheet = ss.insertSheet(sheetName);

      // Agregar encabezados
      if (headers[sheetName]) {
        const headerRange = sheet.getRange(1, 1, 1, headers[sheetName].length);
        headerRange.setValues([headers[sheetName]]);

        // Formato: negrita y color de fondo
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#4285f4');
        headerRange.setFontColor('#ffffff');

        // Congelar primera fila
        sheet.setFrozenRows(1);

        // Auto-ajustar ancho de columnas
        for (let i = 1; i <= headers[sheetName].length; i++) {
          sheet.autoResizeColumn(i);
        }
      }

      creadas.push(sheetName);
    } else {
      existentes.push(sheetName);
    }
  }

  // Log del resultado
  Logger.log('=== INICIALIZACIÓN COMPLETADA ===');
  Logger.log('Hojas creadas: ' + creadas.join(', '));
  Logger.log('Hojas existentes: ' + existentes.join(', '));

  return {
    success: true,
    message: 'Inicialización completada',
    creadas: creadas,
    existentes: existentes
  };
}

function generateId(prefix) {
  return prefix + '_' + Utilities.getUuid().substring(0, 8);
}

function getCurrentDateTime() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

function getCurrentDate() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function findRowByColumn(sheet, columnIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][columnIndex] == value) {
      return i + 1; // +1 porque las filas empiezan en 1
    }
  }
  return -1;
}

function getRowData(sheet, rowIndex, headers) {
  const values = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach((h, i) => obj[h] = values[i]);
  return obj;
}

function getAllData(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => obj[h] = data[i][j]);
    result.push(obj);
  }

  return result;
}

// ==================== USUARIOS ====================

function login(email, googleId) {
  const sheet = getSheet(SHEETS.USUARIOS);
  const data = getAllData(sheet);

  let usuario = data.find(u => u.email === email || u.google_id === googleId);

  if (usuario) {
    // Actualizar última sesión
    const row = findRowByColumn(sheet, 0, usuario.id_usuario);
    if (row > 0) {
      const colIndex = 8; // ultima_sesion
      sheet.getRange(row, colIndex).setValue(getCurrentDateTime());
    }
    return { success: true, usuario: usuario, isNew: false };
  }

  return { success: true, usuario: null, isNew: true };
}

function crearUsuario(data) {
  const sheet = getSheet(SHEETS.USUARIOS);
  const id = generateId('USR');

  const row = [
    id,
    data.email,
    data.nombre,
    data.foto_perfil || '',
    data.google_id || '',
    data.moneda_principal || 'PEN',
    getCurrentDateTime(),
    getCurrentDateTime(),
    true
  ];

  sheet.appendRow(row);

  // Crear espacio personal por defecto
  const espacioResult = crearEspacio({
    nombre: 'Personal',
    descripcion: 'Mi espacio personal',
    id_propietario: id,
    icono: '🏠',
    color: '#5B9A8B'
  });

  // Crear categorías por defecto
  if (espacioResult.success) {
    crearCategoriasPorDefecto(espacioResult.id_espacio);
    crearCuentasPorDefecto(espacioResult.id_espacio);
  }

  return { success: true, id_usuario: id, id_espacio: espacioResult.id_espacio };
}

function getUsuario(idUsuario) {
  const sheet = getSheet(SHEETS.USUARIOS);
  const row = findRowByColumn(sheet, 0, idUsuario);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return { success: true, usuario: getRowData(sheet, row, headers) };
  }

  return { success: false, error: 'Usuario no encontrado' };
}

function actualizarUsuario(data) {
  const sheet = getSheet(SHEETS.USUARIOS);
  const row = findRowByColumn(sheet, 0, data.id_usuario);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_usuario' && h !== 'fecha_registro') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Usuario no encontrado' };
}

// ==================== ESPACIOS ====================

function crearEspacio(data) {
  const sheet = getSheet(SHEETS.ESPACIOS);
  const id = generateId('ESP');

  const row = [
    id,
    data.nombre,
    data.descripcion || '',
    data.id_propietario,
    data.icono || '📁',
    data.color || '#5B9A8B',
    getCurrentDateTime(),
    true
  ];

  sheet.appendRow(row);

  // Agregar propietario como miembro
  agregarMiembroEspacio({
    id_espacio: id,
    id_usuario: data.id_propietario,
    rol: 'propietario'
  });

  return { success: true, id_espacio: id };
}

function getEspacio(idEspacio) {
  const sheet = getSheet(SHEETS.ESPACIOS);
  const row = findRowByColumn(sheet, 0, idEspacio);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return { success: true, espacio: getRowData(sheet, row, headers) };
  }

  return { success: false, error: 'Espacio no encontrado' };
}

function getEspaciosByUsuario(idUsuario) {
  const miembrosSheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  const espaciosSheet = getSheet(SHEETS.ESPACIOS);

  const miembros = getAllData(miembrosSheet).filter(m => m.id_usuario === idUsuario && m.activo);
  const espacios = getAllData(espaciosSheet).filter(e => e.activo);

  const result = miembros.map(m => {
    const espacio = espacios.find(e => e.id_espacio === m.id_espacio);
    return { ...espacio, rol: m.rol };
  }).filter(e => e);

  return { success: true, espacios: result };
}

function actualizarEspacio(data) {
  const sheet = getSheet(SHEETS.ESPACIOS);
  const row = findRowByColumn(sheet, 0, data.id_espacio);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_espacio' && h !== 'fecha_creacion') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Espacio no encontrado' };
}

function agregarMiembroEspacio(data) {
  const sheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  const id = generateId('MBR');

  // Verificar si ya es miembro
  const existentes = getAllData(sheet);
  const existe = existentes.find(m => m.id_espacio === data.id_espacio && m.id_usuario === data.id_usuario && m.activo);

  if (existe) {
    return { success: false, error: 'El usuario ya es miembro del espacio' };
  }

  const row = [
    id,
    data.id_espacio,
    data.id_usuario,
    data.rol || 'miembro',
    getCurrentDateTime(),
    true
  ];

  sheet.appendRow(row);
  return { success: true, id_miembro: id };
}

function eliminarMiembroEspacio(idEspacio, idUsuario) {
  const sheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  const data = getAllData(sheet);

  for (let i = 0; i < data.length; i++) {
    if (data[i].id_espacio === idEspacio && data[i].id_usuario === idUsuario) {
      sheet.getRange(i + 2, 6).setValue(false); // activo = false
      return { success: true };
    }
  }

  return { success: false, error: 'Miembro no encontrado' };
}

function getMiembrosEspacio(idEspacio) {
  const miembrosSheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  const usuariosSheet = getSheet(SHEETS.USUARIOS);

  const miembros = getAllData(miembrosSheet).filter(m => m.id_espacio === idEspacio && m.activo);
  const usuarios = getAllData(usuariosSheet);

  const result = miembros.map(m => {
    const usuario = usuarios.find(u => u.id_usuario === m.id_usuario);
    return {
      ...m,
      nombre: usuario?.nombre,
      email: usuario?.email,
      foto_perfil: usuario?.foto_perfil
    };
  });

  return { success: true, miembros: result };
}

// ==================== CUENTAS ====================

function crearCuenta(data) {
  const sheet = getSheet(SHEETS.CUENTAS);
  const id = generateId('CTA');

  const row = [
    id,
    data.id_espacio,
    data.nombre,
    data.tipo || 'efectivo',
    data.saldo_inicial || 0,
    data.moneda || 'PEN',
    data.color || '#5B9A8B',
    data.icono || '💰',
    data.incluir_total !== false,
    data.orden || 0,
    true,
    getCurrentDateTime()
  ];

  sheet.appendRow(row);
  return { success: true, id_cuenta: id };
}

function getCuentas(idEspacio) {
  const sheet = getSheet(SHEETS.CUENTAS);
  const cuentas = getAllData(sheet).filter(c => c.id_espacio === idEspacio && c.activo);

  // Calcular balance de cada cuenta
  const transSheet = getSheet(SHEETS.TRANSACCIONES);
  const transacciones = getAllData(transSheet);

  cuentas.forEach(cuenta => {
    let balance = parseFloat(cuenta.saldo_inicial) || 0;

    transacciones.filter(t => t.id_cuenta === cuenta.id_cuenta).forEach(t => {
      const monto = parseFloat(t.monto) || 0;
      if (t.tipo === 'ingreso') {
        balance += monto;
      } else {
        balance -= monto;
      }
    });

    cuenta.balance = balance;
  });

  return { success: true, cuentas: cuentas };
}

function getCuenta(idCuenta) {
  const sheet = getSheet(SHEETS.CUENTAS);
  const row = findRowByColumn(sheet, 0, idCuenta);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return { success: true, cuenta: getRowData(sheet, row, headers) };
  }

  return { success: false, error: 'Cuenta no encontrada' };
}

function getBalanceCuenta(idCuenta) {
  const cuentaResult = getCuenta(idCuenta);
  if (!cuentaResult.success) return cuentaResult;

  const cuenta = cuentaResult.cuenta;
  let balance = parseFloat(cuenta.saldo_inicial) || 0;

  const transSheet = getSheet(SHEETS.TRANSACCIONES);
  const transacciones = getAllData(transSheet).filter(t => t.id_cuenta === idCuenta);

  transacciones.forEach(t => {
    const monto = parseFloat(t.monto) || 0;
    if (t.tipo === 'ingreso') {
      balance += monto;
    } else {
      balance -= monto;
    }
  });

  // Considerar transferencias
  const transfSheet = getSheet(SHEETS.TRANSFERENCIAS);
  const transferencias = getAllData(transfSheet);

  transferencias.filter(t => t.cuenta_origen === idCuenta).forEach(t => {
    balance -= parseFloat(t.monto) || 0;
  });

  transferencias.filter(t => t.cuenta_destino === idCuenta).forEach(t => {
    balance += parseFloat(t.monto) || 0;
  });

  return { success: true, balance: balance };
}

function actualizarCuenta(data) {
  const sheet = getSheet(SHEETS.CUENTAS);
  const row = findRowByColumn(sheet, 0, data.id_cuenta);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_cuenta' && h !== 'fecha_creacion') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Cuenta no encontrada' };
}

function eliminarCuenta(idCuenta) {
  const sheet = getSheet(SHEETS.CUENTAS);
  const row = findRowByColumn(sheet, 0, idCuenta);

  if (row > 0) {
    sheet.getRange(row, 11).setValue(false); // activo = false
    return { success: true };
  }

  return { success: false, error: 'Cuenta no encontrada' };
}

function crearCuentasPorDefecto(idEspacio) {
  const cuentasDefault = [
    { nombre: 'Efectivo', tipo: 'efectivo', icono: '💵', color: '#4CAF50' },
    { nombre: 'Cuenta bancaria', tipo: 'banco', icono: '🏦', color: '#2196F3' },
    { nombre: 'Tarjeta de crédito', tipo: 'tarjeta', icono: '💳', color: '#FF9800' }
  ];

  cuentasDefault.forEach((c, i) => {
    crearCuenta({
      id_espacio: idEspacio,
      ...c,
      saldo_inicial: 0,
      orden: i
    });
  });
}

// ==================== CATEGORÍAS ====================

function crearCategoria(data) {
  const sheet = getSheet(SHEETS.CATEGORIAS);
  const id = generateId('CAT');

  const row = [
    id,
    data.id_espacio,
    data.nombre,
    data.tipo,
    data.icono || '📦',
    data.color || '#757575',
    data.es_sistema || false,
    data.orden || 0,
    true
  ];

  sheet.appendRow(row);
  return { success: true, id_categoria: id };
}

function getCategorias(idEspacio, tipo) {
  const sheet = getSheet(SHEETS.CATEGORIAS);
  let categorias = getAllData(sheet).filter(c => c.id_espacio === idEspacio && c.activo);

  if (tipo) {
    categorias = categorias.filter(c => c.tipo === tipo);
  }

  return { success: true, categorias: categorias.sort((a, b) => a.orden - b.orden) };
}

function getCategoria(idCategoria) {
  const sheet = getSheet(SHEETS.CATEGORIAS);
  const row = findRowByColumn(sheet, 0, idCategoria);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return { success: true, categoria: getRowData(sheet, row, headers) };
  }

  return { success: false, error: 'Categoría no encontrada' };
}

function actualizarCategoria(data) {
  const sheet = getSheet(SHEETS.CATEGORIAS);
  const row = findRowByColumn(sheet, 0, data.id_categoria);

  if (row > 0) {
    // No permitir editar categorías del sistema
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const categoria = getRowData(sheet, row, headers);

    if (categoria.es_sistema) {
      return { success: false, error: 'No se puede editar una categoría del sistema' };
    }

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_categoria' && h !== 'es_sistema') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Categoría no encontrada' };
}

function eliminarCategoria(idCategoria) {
  const sheet = getSheet(SHEETS.CATEGORIAS);
  const row = findRowByColumn(sheet, 0, idCategoria);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const categoria = getRowData(sheet, row, headers);

    if (categoria.es_sistema) {
      return { success: false, error: 'No se puede eliminar una categoría del sistema' };
    }

    sheet.getRange(row, 9).setValue(false); // activo = false
    return { success: true };
  }

  return { success: false, error: 'Categoría no encontrada' };
}

function crearCategoriasPorDefecto(idEspacio) {
  const categoriasGasto = [
    { nombre: 'Alimentación', icono: '🍴', color: '#E91E63' },
    { nombre: 'Transporte', icono: '🚗', color: '#9C27B0' },
    { nombre: 'Entretenimiento', icono: '🎬', color: '#673AB7' },
    { nombre: 'Compras', icono: '🛒', color: '#3F51B5' },
    { nombre: 'Salud', icono: '🏥', color: '#03A9F4' },
    { nombre: 'Educación', icono: '📚', color: '#00BCD4' },
    { nombre: 'Servicios', icono: '💡', color: '#009688' },
    { nombre: 'Hogar', icono: '🏠', color: '#4CAF50' },
    { nombre: 'Otros gastos', icono: '📦', color: '#757575' }
  ];

  const categoriasIngreso = [
    { nombre: 'Salario', icono: '💼', color: '#4CAF50' },
    { nombre: 'Freelance', icono: '💻', color: '#8BC34A' },
    { nombre: 'Inversiones', icono: '📈', color: '#CDDC39' },
    { nombre: 'Regalo', icono: '🎁', color: '#FFEB3B' },
    { nombre: 'Otros ingresos', icono: '💰', color: '#FFC107' }
  ];

  categoriasGasto.forEach((c, i) => {
    crearCategoria({
      id_espacio: idEspacio,
      ...c,
      tipo: 'gasto',
      es_sistema: true,
      orden: i
    });
  });

  categoriasIngreso.forEach((c, i) => {
    crearCategoria({
      id_espacio: idEspacio,
      ...c,
      tipo: 'ingreso',
      es_sistema: true,
      orden: i
    });
  });
}

// ==================== TRANSACCIONES ====================

function crearTransaccion(data) {
  const sheet = getSheet(SHEETS.TRANSACCIONES);
  const id = generateId('TRX');

  const now = new Date();
  const fecha = data.fecha || Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const hora = data.hora || Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss");

  const row = [
    id,
    data.id_espacio,
    data.id_usuario,
    data.id_cuenta,
    data.id_categoria,
    data.tipo,
    parseFloat(data.monto),
    data.descripcion || '',
    fecha,
    hora,
    data.ubicacion || '',
    data.notas || '',
    getCurrentDateTime(),
    getCurrentDateTime()
  ];

  sheet.appendRow(row);
  return { success: true, id_transaccion: id };
}

function getTransacciones(idEspacio, fechaInicio, fechaFin, tipo, idCategoria, idCuenta) {
  const sheet = getSheet(SHEETS.TRANSACCIONES);
  let transacciones = getAllData(sheet).filter(t => t.id_espacio === idEspacio);

  if (fechaInicio) {
    transacciones = transacciones.filter(t => t.fecha >= fechaInicio);
  }

  if (fechaFin) {
    transacciones = transacciones.filter(t => t.fecha <= fechaFin);
  }

  if (tipo) {
    transacciones = transacciones.filter(t => t.tipo === tipo);
  }

  if (idCategoria) {
    transacciones = transacciones.filter(t => t.id_categoria === idCategoria);
  }

  if (idCuenta) {
    transacciones = transacciones.filter(t => t.id_cuenta === idCuenta);
  }

  // Agregar información de categoría y cuenta
  const categoriasSheet = getSheet(SHEETS.CATEGORIAS);
  const cuentasSheet = getSheet(SHEETS.CUENTAS);
  const categorias = getAllData(categoriasSheet);
  const cuentas = getAllData(cuentasSheet);

  transacciones = transacciones.map(t => {
    const categoria = categorias.find(c => c.id_categoria === t.id_categoria);
    const cuenta = cuentas.find(c => c.id_cuenta === t.id_cuenta);
    return {
      ...t,
      categoria_nombre: categoria?.nombre,
      categoria_icono: categoria?.icono,
      categoria_color: categoria?.color,
      cuenta_nombre: cuenta?.nombre,
      cuenta_icono: cuenta?.icono
    };
  });

  // Ordenar por fecha descendente
  transacciones.sort((a, b) => {
    const dateA = new Date(a.fecha + ' ' + a.hora);
    const dateB = new Date(b.fecha + ' ' + b.hora);
    return dateB - dateA;
  });

  return { success: true, transacciones: transacciones };
}

function getTransaccion(idTransaccion) {
  const sheet = getSheet(SHEETS.TRANSACCIONES);
  const row = findRowByColumn(sheet, 0, idTransaccion);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const transaccion = getRowData(sheet, row, headers);

    // Agregar evidencias
    const evidenciasResult = getEvidenciasByTransaccion(idTransaccion);
    transaccion.evidencias = evidenciasResult.evidencias || [];

    return { success: true, transaccion: transaccion };
  }

  return { success: false, error: 'Transacción no encontrada' };
}

function getTransaccionesHoy(idEspacio) {
  const hoy = getCurrentDate();
  return getTransacciones(idEspacio, hoy, hoy);
}

function actualizarTransaccion(data) {
  const sheet = getSheet(SHEETS.TRANSACCIONES);
  const row = findRowByColumn(sheet, 0, data.id_transaccion);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_transaccion' && h !== 'fecha_creacion') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    // Actualizar fecha_modificacion
    const modIndex = headers.indexOf('fecha_modificacion');
    if (modIndex >= 0) {
      sheet.getRange(row, modIndex + 1).setValue(getCurrentDateTime());
    }

    return { success: true };
  }

  return { success: false, error: 'Transacción no encontrada' };
}

function eliminarTransaccion(idTransaccion) {
  const sheet = getSheet(SHEETS.TRANSACCIONES);
  const row = findRowByColumn(sheet, 0, idTransaccion);

  if (row > 0) {
    // Eliminar evidencias asociadas
    const evidenciasResult = getEvidenciasByTransaccion(idTransaccion);
    if (evidenciasResult.evidencias) {
      evidenciasResult.evidencias.forEach(e => {
        eliminarEvidencia(e.id_evidencia);
      });
    }

    sheet.deleteRow(row);
    return { success: true };
  }

  return { success: false, error: 'Transacción no encontrada' };
}

// ==================== EVIDENCIAS ====================

function subirEvidencia(data) {
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

    // Decodificar Base64
    const blob = Utilities.newBlob(
      Utilities.base64Decode(data.contenido_base64),
      data.mime_type,
      data.nombre_archivo
    );

    // Crear archivo en Drive
    const archivo = folder.createFile(blob);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const url = archivo.getUrl();
    const fileId = archivo.getId();

    // Guardar en hoja
    const sheet = getSheet(SHEETS.EVIDENCIAS);
    const id = generateId('EVD');

    const row = [
      id,
      data.id_transaccion,
      data.tipo || 'imagen',
      url,
      data.nombre_archivo,
      data.tamano || blob.getBytes().length,
      getCurrentDateTime()
    ];

    sheet.appendRow(row);

    return {
      success: true,
      id_evidencia: id,
      url: url,
      file_id: fileId
    };

  } catch (error) {
    return { success: false, error: 'Error al subir archivo: ' + error.toString() };
  }
}

function getEvidenciasByTransaccion(idTransaccion) {
  const sheet = getSheet(SHEETS.EVIDENCIAS);
  const evidencias = getAllData(sheet).filter(e => e.id_transaccion === idTransaccion);
  return { success: true, evidencias: evidencias };
}

function eliminarEvidencia(idEvidencia) {
  const sheet = getSheet(SHEETS.EVIDENCIAS);
  const data = getAllData(sheet);

  for (let i = 0; i < data.length; i++) {
    if (data[i].id_evidencia === idEvidencia) {
      // Intentar eliminar de Drive
      try {
        const url = data[i].url;
        const fileId = url.match(/[-\w]{25,}/);
        if (fileId) {
          DriveApp.getFileById(fileId[0]).setTrashed(true);
        }
      } catch (e) {
        // Ignorar error si el archivo ya no existe
      }

      sheet.deleteRow(i + 2);
      return { success: true };
    }
  }

  return { success: false, error: 'Evidencia no encontrada' };
}

// ==================== DEUDAS ====================

function crearDeuda(data) {
  const sheet = getSheet(SHEETS.DEUDAS);
  const id = generateId('DDA');

  const row = [
    id,
    data.id_espacio,
    data.id_usuario,
    data.tipo, // 'prestamo' o 'deuda'
    data.persona,
    parseFloat(data.monto_original),
    parseFloat(data.monto_original), // monto_pendiente inicial
    data.descripcion || '',
    getCurrentDateTime(),
    data.fecha_vencimiento || '',
    'pendiente',
    data.recordatorio || false,
    data.notas || ''
  ];

  sheet.appendRow(row);
  return { success: true, id_deuda: id };
}

function getDeudas(idEspacio, tipo, estado) {
  const sheet = getSheet(SHEETS.DEUDAS);
  let deudas = getAllData(sheet).filter(d => d.id_espacio === idEspacio);

  if (tipo) {
    deudas = deudas.filter(d => d.tipo === tipo);
  }

  if (estado) {
    deudas = deudas.filter(d => d.estado === estado);
  }

  // Ordenar por fecha de creación descendente
  deudas.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

  return { success: true, deudas: deudas };
}

function getDeuda(idDeuda) {
  const sheet = getSheet(SHEETS.DEUDAS);
  const row = findRowByColumn(sheet, 0, idDeuda);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const deuda = getRowData(sheet, row, headers);

    // Agregar pagos
    const pagosResult = getPagosDeuda(idDeuda);
    deuda.pagos = pagosResult.pagos || [];

    return { success: true, deuda: deuda };
  }

  return { success: false, error: 'Deuda no encontrada' };
}

function actualizarDeuda(data) {
  const sheet = getSheet(SHEETS.DEUDAS);
  const row = findRowByColumn(sheet, 0, data.id_deuda);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_deuda' && h !== 'fecha_creacion') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Deuda no encontrada' };
}

function eliminarDeuda(idDeuda) {
  const sheet = getSheet(SHEETS.DEUDAS);
  const row = findRowByColumn(sheet, 0, idDeuda);

  if (row > 0) {
    sheet.deleteRow(row);
    return { success: true };
  }

  return { success: false, error: 'Deuda no encontrada' };
}

function registrarPagoDeuda(data) {
  const deudaSheet = getSheet(SHEETS.DEUDAS);
  const pagosSheet = getSheet(SHEETS.PAGOS_DEUDA);

  const deudaRow = findRowByColumn(deudaSheet, 0, data.id_deuda);
  if (deudaRow < 0) {
    return { success: false, error: 'Deuda no encontrada' };
  }

  const headers = deudaSheet.getRange(1, 1, 1, deudaSheet.getLastColumn()).getValues()[0];
  const deuda = getRowData(deudaSheet, deudaRow, headers);

  const montoPago = parseFloat(data.monto);
  const montoPendiente = parseFloat(deuda.monto_pendiente) - montoPago;

  // Registrar pago
  const idPago = generateId('PGO');
  const rowPago = [
    idPago,
    data.id_deuda,
    montoPago,
    data.fecha || getCurrentDate(),
    data.notas || '',
    data.id_transaccion || ''
  ];

  pagosSheet.appendRow(rowPago);

  // Actualizar deuda
  const pendienteIndex = headers.indexOf('monto_pendiente');
  const estadoIndex = headers.indexOf('estado');

  deudaSheet.getRange(deudaRow, pendienteIndex + 1).setValue(Math.max(0, montoPendiente));

  if (montoPendiente <= 0) {
    deudaSheet.getRange(deudaRow, estadoIndex + 1).setValue('pagada');
  }

  return { success: true, id_pago: idPago, monto_pendiente: Math.max(0, montoPendiente) };
}

function getPagosDeuda(idDeuda) {
  const sheet = getSheet(SHEETS.PAGOS_DEUDA);
  const pagos = getAllData(sheet).filter(p => p.id_deuda === idDeuda);
  return { success: true, pagos: pagos };
}

// ==================== TRANSFERENCIAS ====================

function realizarTransferencia(data) {
  const sheet = getSheet(SHEETS.TRANSFERENCIAS);
  const id = generateId('TRF');

  // Validar cuentas
  const cuentaOrigen = getCuenta(data.cuenta_origen);
  const cuentaDestino = getCuenta(data.cuenta_destino);

  if (!cuentaOrigen.success || !cuentaDestino.success) {
    return { success: false, error: 'Cuenta no encontrada' };
  }

  const row = [
    id,
    data.id_espacio,
    data.id_usuario,
    data.cuenta_origen,
    data.cuenta_destino,
    parseFloat(data.monto),
    data.fecha || getCurrentDate(),
    data.nota || ''
  ];

  sheet.appendRow(row);
  return { success: true, id_transferencia: id };
}

function getTransferencias(idEspacio, fechaInicio, fechaFin) {
  const sheet = getSheet(SHEETS.TRANSFERENCIAS);
  let transferencias = getAllData(sheet).filter(t => t.id_espacio === idEspacio);

  if (fechaInicio) {
    transferencias = transferencias.filter(t => t.fecha >= fechaInicio);
  }

  if (fechaFin) {
    transferencias = transferencias.filter(t => t.fecha <= fechaFin);
  }

  // Agregar info de cuentas
  const cuentasSheet = getSheet(SHEETS.CUENTAS);
  const cuentas = getAllData(cuentasSheet);

  transferencias = transferencias.map(t => {
    const origen = cuentas.find(c => c.id_cuenta === t.cuenta_origen);
    const destino = cuentas.find(c => c.id_cuenta === t.cuenta_destino);
    return {
      ...t,
      cuenta_origen_nombre: origen?.nombre,
      cuenta_origen_icono: origen?.icono,
      cuenta_destino_nombre: destino?.nombre,
      cuenta_destino_icono: destino?.icono
    };
  });

  return { success: true, transferencias: transferencias };
}

// ==================== TRANSFERENCIAS INTER-USUARIO ====================

/**
 * Busca un usuario por email y retorna su información básica y espacios
 */
function buscarUsuarioPorEmail(email) {
  if (!email) {
    return { success: false, error: 'Email requerido' };
  }

  const usuariosSheet = getSheet(SHEETS.USUARIOS);
  const usuarios = getAllData(usuariosSheet);

  const usuario = usuarios.find(u => u.email === email && u.activo);

  if (!usuario) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  // Obtener espacios del usuario
  const miembrosSheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  const espaciosSheet = getSheet(SHEETS.ESPACIOS);

  const miembros = getAllData(miembrosSheet).filter(m => m.id_usuario === usuario.id_usuario && m.activo);
  const espacios = getAllData(espaciosSheet).filter(e => e.activo);

  const espaciosUsuario = miembros.map(m => {
    const espacio = espacios.find(e => e.id_espacio === m.id_espacio);
    if (espacio) {
      return {
        id_espacio: espacio.id_espacio,
        nombre: espacio.nombre,
        icono: espacio.icono
      };
    }
    return null;
  }).filter(e => e);

  return {
    success: true,
    usuario: {
      id_usuario: usuario.id_usuario,
      nombre: usuario.nombre,
      email: usuario.email,
      foto_perfil: usuario.foto_perfil
    },
    espacios: espaciosUsuario
  };
}

/**
 * Obtiene las cuentas de un espacio (versión pública para transferencias)
 */
function getCuentasDeEspacioPublico(idEspacio) {
  if (!idEspacio) {
    return { success: false, error: 'ID de espacio requerido' };
  }

  const sheet = getSheet(SHEETS.CUENTAS);
  const cuentas = getAllData(sheet)
    .filter(c => c.id_espacio === idEspacio && c.activo)
    .map(c => ({
      id_cuenta: c.id_cuenta,
      nombre: c.nombre,
      tipo: c.tipo,
      icono: c.icono,
      moneda: c.moneda
    }));

  return { success: true, cuentas: cuentas };
}

/**
 * Crea una transferencia inter-usuario
 * Automáticamente completa la transferencia moviendo el dinero
 */
function crearTransferenciaInterUsuario(data) {
  // Validaciones
  if (!data.id_espacio_origen || !data.id_cuenta_origen ||
      !data.id_espacio_destino || !data.id_cuenta_destino ||
      !data.monto || !data.creado_por) {
    return { success: false, error: 'Faltan datos requeridos' };
  }

  // Verificar que no sea transferencia a la misma cuenta
  if (data.id_cuenta_origen === data.id_cuenta_destino) {
    return { success: false, error: 'No puedes transferir a la misma cuenta' };
  }

  // Verificar que las cuentas existan
  const cuentaOrigen = getCuenta(data.id_cuenta_origen);
  const cuentaDestino = getCuenta(data.id_cuenta_destino);

  if (!cuentaOrigen.success) {
    return { success: false, error: 'Cuenta origen no encontrada' };
  }

  if (!cuentaDestino.success) {
    return { success: false, error: 'Cuenta destino no encontrada' };
  }

  // Verificar saldo suficiente
  const balanceOrigen = getBalanceCuenta(data.id_cuenta_origen);
  if (balanceOrigen.success && balanceOrigen.balance < parseFloat(data.monto)) {
    return { success: false, error: 'Saldo insuficiente en la cuenta origen' };
  }

  const monto = parseFloat(data.monto);
  const now = getCurrentDateTime();

  // Crear registro de transferencia
  const sheet = getSheet(SHEETS.TRANSFERENCIAS_INTER_USUARIO);
  const id = generateId('TIU');

  const row = [
    id,
    data.id_espacio_origen,
    data.id_cuenta_origen,
    data.id_espacio_destino,
    data.id_cuenta_destino,
    monto,
    data.concepto || '',
    'completada', // Estado: automáticamente completada
    now,
    now, // fecha_completada
    data.creado_por
  ];

  sheet.appendRow(row);

  // Crear transacción de GASTO en cuenta origen
  const transGasto = crearTransaccion({
    id_espacio: data.id_espacio_origen,
    id_usuario: data.creado_por,
    id_cuenta: data.id_cuenta_origen,
    id_categoria: '', // Sin categoría
    tipo: 'gasto',
    monto: monto,
    descripcion: 'Transferencia enviada: ' + (data.concepto || 'Sin concepto'),
    notas: 'Transferencia inter-usuario ID: ' + id
  });

  // Crear transacción de INGRESO en cuenta destino
  const transIngreso = crearTransaccion({
    id_espacio: data.id_espacio_destino,
    id_usuario: data.creado_por,
    id_cuenta: data.id_cuenta_destino,
    id_categoria: '', // Sin categoría
    tipo: 'ingreso',
    monto: monto,
    descripcion: 'Transferencia recibida: ' + (data.concepto || 'Sin concepto'),
    notas: 'Transferencia inter-usuario ID: ' + id
  });

  // Notificar al destinatario
  // Obtener el propietario del espacio destino
  const espacioDestino = getEspacio(data.id_espacio_destino);
  if (espacioDestino.success && espacioDestino.espacio.id_propietario) {
    crearNotificacion({
      id_usuario: espacioDestino.espacio.id_propietario,
      tipo: 'transferencia',
      titulo: 'Transferencia recibida',
      mensaje: 'Has recibido S/ ' + monto.toFixed(2) + ' - ' + (data.concepto || 'Sin concepto'),
      datos: { id_transferencia: id }
    });
  }

  return {
    success: true,
    id_transferencia: id,
    id_transaccion_gasto: transGasto.id_transaccion,
    id_transaccion_ingreso: transIngreso.id_transaccion
  };
}

/**
 * Obtiene las transferencias inter-usuario de un espacio (enviadas y recibidas)
 */
function getTransferenciasInterUsuario(idEspacio) {
  if (!idEspacio) {
    return { success: false, error: 'ID de espacio requerido' };
  }

  const sheet = getSheet(SHEETS.TRANSFERENCIAS_INTER_USUARIO);
  const data = getAllData(sheet);

  // Filtrar enviadas y recibidas
  const enviadas = data.filter(t => t.id_espacio_origen === idEspacio);
  const recibidas = data.filter(t => t.id_espacio_destino === idEspacio);

  // Obtener información adicional
  const cuentasSheet = getSheet(SHEETS.CUENTAS);
  const espaciosSheet = getSheet(SHEETS.ESPACIOS);
  const usuariosSheet = getSheet(SHEETS.USUARIOS);

  const cuentas = getAllData(cuentasSheet);
  const espacios = getAllData(espaciosSheet);
  const usuarios = getAllData(usuariosSheet);

  const enriquecerTransferencia = (t) => {
    const cuentaOrigen = cuentas.find(c => c.id_cuenta === t.id_cuenta_origen);
    const cuentaDestino = cuentas.find(c => c.id_cuenta === t.id_cuenta_destino);
    const espacioOrigen = espacios.find(e => e.id_espacio === t.id_espacio_origen);
    const espacioDestino = espacios.find(e => e.id_espacio === t.id_espacio_destino);
    const creador = usuarios.find(u => u.id_usuario === t.creado_por);

    return {
      ...t,
      cuenta_origen_nombre: cuentaOrigen?.nombre,
      cuenta_origen_icono: cuentaOrigen?.icono,
      cuenta_destino_nombre: cuentaDestino?.nombre,
      cuenta_destino_icono: cuentaDestino?.icono,
      espacio_origen_nombre: espacioOrigen?.nombre,
      espacio_destino_nombre: espacioDestino?.nombre,
      creado_por_nombre: creador?.nombre,
      creado_por_email: creador?.email
    };
  };

  return {
    success: true,
    enviadas: enviadas.map(enriquecerTransferencia).sort((a, b) =>
      new Date(b.fecha_solicitud) - new Date(a.fecha_solicitud)
    ),
    recibidas: recibidas.map(enriquecerTransferencia).sort((a, b) =>
      new Date(b.fecha_solicitud) - new Date(a.fecha_solicitud)
    )
  };
}

// ==================== PRESUPUESTOS ====================

function crearPresupuesto(data) {
  const sheet = getSheet(SHEETS.PRESUPUESTOS);
  const id = generateId('PRE');

  const row = [
    id,
    data.id_espacio,
    data.id_categoria,
    parseFloat(data.monto_limite),
    parseInt(data.mes),
    parseInt(data.anio),
    data.alerta_porcentaje || 80,
    true
  ];

  sheet.appendRow(row);
  return { success: true, id_presupuesto: id };
}

function getPresupuestos(idEspacio, mes, anio) {
  const sheet = getSheet(SHEETS.PRESUPUESTOS);
  let presupuestos = getAllData(sheet).filter(p => p.id_espacio === idEspacio && p.activo);

  if (mes) {
    presupuestos = presupuestos.filter(p => p.mes == mes);
  }

  if (anio) {
    presupuestos = presupuestos.filter(p => p.anio == anio);
  }

  // Agregar info de categoría y progreso
  const categoriasSheet = getSheet(SHEETS.CATEGORIAS);
  const categorias = getAllData(categoriasSheet);

  presupuestos = presupuestos.map(p => {
    const categoria = categorias.find(c => c.id_categoria === p.id_categoria);
    const progreso = calcularProgresoPresupuesto(p);
    return {
      ...p,
      categoria_nombre: categoria?.nombre,
      categoria_icono: categoria?.icono,
      categoria_color: categoria?.color,
      gastado: progreso.gastado,
      porcentaje: progreso.porcentaje
    };
  });

  return { success: true, presupuestos: presupuestos };
}

function getProgresoPresupuesto(idPresupuesto) {
  const sheet = getSheet(SHEETS.PRESUPUESTOS);
  const row = findRowByColumn(sheet, 0, idPresupuesto);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const presupuesto = getRowData(sheet, row, headers);
    return { success: true, ...calcularProgresoPresupuesto(presupuesto) };
  }

  return { success: false, error: 'Presupuesto no encontrado' };
}

function calcularProgresoPresupuesto(presupuesto) {
  const transSheet = getSheet(SHEETS.TRANSACCIONES);
  const transacciones = getAllData(transSheet);

  // Filtrar por categoría, mes y año
  const gastado = transacciones
    .filter(t =>
      t.id_categoria === presupuesto.id_categoria &&
      t.tipo === 'gasto' &&
      new Date(t.fecha).getMonth() + 1 == presupuesto.mes &&
      new Date(t.fecha).getFullYear() == presupuesto.anio
    )
    .reduce((sum, t) => sum + parseFloat(t.monto), 0);

  const porcentaje = (gastado / parseFloat(presupuesto.monto_limite)) * 100;

  return {
    gastado: gastado,
    limite: parseFloat(presupuesto.monto_limite),
    porcentaje: Math.round(porcentaje * 100) / 100,
    excedido: porcentaje > 100,
    alerta: porcentaje >= presupuesto.alerta_porcentaje
  };
}

function actualizarPresupuesto(data) {
  const sheet = getSheet(SHEETS.PRESUPUESTOS);
  const row = findRowByColumn(sheet, 0, data.id_presupuesto);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_presupuesto') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Presupuesto no encontrado' };
}

function eliminarPresupuesto(idPresupuesto) {
  const sheet = getSheet(SHEETS.PRESUPUESTOS);
  const row = findRowByColumn(sheet, 0, idPresupuesto);

  if (row > 0) {
    sheet.getRange(row, 8).setValue(false); // activo = false
    return { success: true };
  }

  return { success: false, error: 'Presupuesto no encontrado' };
}

// ==================== GASTOS RECURRENTES ====================

function crearGastoRecurrente(data) {
  const sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  const id = generateId('GRC');

  // Calcular próxima ejecución
  const proximoEjecucion = calcularProximaEjecucion(data.frecuencia, data.dia_ejecucion);

  const row = [
    id,
    data.id_espacio,
    data.id_categoria,
    data.id_cuenta,
    data.descripcion,
    parseFloat(data.monto),
    data.frecuencia, // 'diario', 'semanal', 'mensual', 'anual'
    data.dia_ejecucion || 1,
    proximoEjecucion,
    true,
    getCurrentDateTime()
  ];

  sheet.appendRow(row);
  return { success: true, id_gasto_recurrente: id };
}

function calcularProximaEjecucion(frecuencia, diaEjecucion) {
  const hoy = new Date();
  let proxima = new Date();

  switch(frecuencia) {
    case 'diario':
      proxima.setDate(hoy.getDate() + 1);
      break;
    case 'semanal':
      proxima.setDate(hoy.getDate() + (7 - hoy.getDay() + diaEjecucion) % 7);
      if (proxima <= hoy) proxima.setDate(proxima.getDate() + 7);
      break;
    case 'mensual':
      proxima.setDate(diaEjecucion);
      if (proxima <= hoy) proxima.setMonth(proxima.getMonth() + 1);
      break;
    case 'anual':
      proxima.setMonth(0);
      proxima.setDate(diaEjecucion);
      if (proxima <= hoy) proxima.setFullYear(proxima.getFullYear() + 1);
      break;
  }

  return Utilities.formatDate(proxima, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function getGastosRecurrentes(idEspacio) {
  const sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  let gastos = getAllData(sheet).filter(g => g.id_espacio === idEspacio && g.activo);

  // Agregar info de categoría y cuenta
  const categoriasSheet = getSheet(SHEETS.CATEGORIAS);
  const cuentasSheet = getSheet(SHEETS.CUENTAS);
  const categorias = getAllData(categoriasSheet);
  const cuentas = getAllData(cuentasSheet);

  gastos = gastos.map(g => {
    const categoria = categorias.find(c => c.id_categoria === g.id_categoria);
    const cuenta = cuentas.find(c => c.id_cuenta === g.id_cuenta);
    return {
      ...g,
      categoria_nombre: categoria?.nombre,
      categoria_icono: categoria?.icono,
      cuenta_nombre: cuenta?.nombre
    };
  });

  return { success: true, gastos_recurrentes: gastos };
}

function actualizarGastoRecurrente(data) {
  const sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  const row = findRowByColumn(sheet, 0, data.id_gasto_recurrente);

  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    headers.forEach((h, i) => {
      if (data[h] !== undefined && h !== 'id_gasto_recurrente' && h !== 'fecha_creacion') {
        sheet.getRange(row, i + 1).setValue(data[h]);
      }
    });

    return { success: true };
  }

  return { success: false, error: 'Gasto recurrente no encontrado' };
}

function eliminarGastoRecurrente(idGastoRecurrente) {
  const sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  const row = findRowByColumn(sheet, 0, idGastoRecurrente);

  if (row > 0) {
    sheet.getRange(row, 10).setValue(false); // activo = false
    return { success: true };
  }

  return { success: false, error: 'Gasto recurrente no encontrado' };
}

function ejecutarGastoRecurrente(idGastoRecurrente) {
  const sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  const row = findRowByColumn(sheet, 0, idGastoRecurrente);

  if (row < 0) {
    return { success: false, error: 'Gasto recurrente no encontrado' };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const gasto = getRowData(sheet, row, headers);

  // Crear transacción
  const transResult = crearTransaccion({
    id_espacio: gasto.id_espacio,
    id_usuario: '', // Sistema
    id_cuenta: gasto.id_cuenta,
    id_categoria: gasto.id_categoria,
    tipo: 'gasto',
    monto: gasto.monto,
    descripcion: gasto.descripcion + ' (Recurrente)',
    notas: 'Generado automáticamente'
  });

  // Actualizar próxima ejecución
  const proximaIndex = headers.indexOf('proximo_ejecucion');
  const proximaEjecucion = calcularProximaEjecucion(gasto.frecuencia, gasto.dia_ejecucion);
  sheet.getRange(row, proximaIndex + 1).setValue(proximaEjecucion);

  return { success: true, id_transaccion: transResult.id_transaccion };
}

// Función para ejecutar automáticamente los gastos recurrentes (Trigger diario)
function ejecutarGastosRecurrentesPendientes() {
  const sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  const gastos = getAllData(sheet).filter(g => g.activo);
  const hoy = getCurrentDate();

  gastos.forEach(gasto => {
    if (gasto.proximo_ejecucion <= hoy) {
      ejecutarGastoRecurrente(gasto.id_gasto_recurrente);
    }
  });
}

// ==================== ETIQUETAS ====================

function crearEtiqueta(data) {
  const sheet = getSheet(SHEETS.ETIQUETAS);
  const id = generateId('ETQ');

  const row = [
    id,
    data.id_espacio,
    data.nombre,
    data.color || '#757575'
  ];

  sheet.appendRow(row);
  return { success: true, id_etiqueta: id };
}

function getEtiquetas(idEspacio) {
  const sheet = getSheet(SHEETS.ETIQUETAS);
  const etiquetas = getAllData(sheet).filter(e => e.id_espacio === idEspacio);
  return { success: true, etiquetas: etiquetas };
}

function eliminarEtiqueta(idEtiqueta) {
  const sheet = getSheet(SHEETS.ETIQUETAS);
  const row = findRowByColumn(sheet, 0, idEtiqueta);

  if (row > 0) {
    // Eliminar relaciones
    const relSheet = getSheet(SHEETS.TRANSACCION_ETIQUETAS);
    const relData = getAllData(relSheet);
    for (let i = relData.length - 1; i >= 0; i--) {
      if (relData[i].id_etiqueta === idEtiqueta) {
        relSheet.deleteRow(i + 2);
      }
    }

    sheet.deleteRow(row);
    return { success: true };
  }

  return { success: false, error: 'Etiqueta no encontrada' };
}

function asignarEtiqueta(idTransaccion, idEtiqueta) {
  const sheet = getSheet(SHEETS.TRANSACCION_ETIQUETAS);

  // Verificar si ya existe
  const existentes = getAllData(sheet);
  const existe = existentes.find(r => r.id_transaccion === idTransaccion && r.id_etiqueta === idEtiqueta);

  if (existe) {
    return { success: false, error: 'La etiqueta ya está asignada' };
  }

  const id = generateId('TEQ');
  sheet.appendRow([id, idTransaccion, idEtiqueta]);

  return { success: true };
}

function removerEtiqueta(idTransaccion, idEtiqueta) {
  const sheet = getSheet(SHEETS.TRANSACCION_ETIQUETAS);
  const data = getAllData(sheet);

  for (let i = 0; i < data.length; i++) {
    if (data[i].id_transaccion === idTransaccion && data[i].id_etiqueta === idEtiqueta) {
      sheet.deleteRow(i + 2);
      return { success: true };
    }
  }

  return { success: false, error: 'Relación no encontrada' };
}

// ==================== NOTIFICACIONES ====================

function crearNotificacion(data) {
  const sheet = getSheet(SHEETS.NOTIFICACIONES);
  const id = generateId('NTF');

  const row = [
    id,
    data.id_usuario,
    data.tipo, // 'presupuesto', 'deuda', 'recurrente', 'sistema'
    data.titulo,
    data.mensaje,
    JSON.stringify(data.datos || {}),
    false,
    getCurrentDateTime()
  ];

  sheet.appendRow(row);
  return { success: true, id_notificacion: id };
}

function getNotificaciones(idUsuario, leida) {
  const sheet = getSheet(SHEETS.NOTIFICACIONES);
  let notificaciones = getAllData(sheet).filter(n => n.id_usuario === idUsuario);

  if (leida !== undefined) {
    const leidaBool = leida === 'true' || leida === true;
    notificaciones = notificaciones.filter(n => n.leida === leidaBool);
  }

  // Parsear datos JSON
  notificaciones = notificaciones.map(n => ({
    ...n,
    datos: JSON.parse(n.datos || '{}')
  }));

  // Ordenar por fecha descendente
  notificaciones.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

  return { success: true, notificaciones: notificaciones };
}

function marcarNotificacionLeida(idNotificacion) {
  const sheet = getSheet(SHEETS.NOTIFICACIONES);
  const row = findRowByColumn(sheet, 0, idNotificacion);

  if (row > 0) {
    sheet.getRange(row, 7).setValue(true); // leida = true
    return { success: true };
  }

  return { success: false, error: 'Notificación no encontrada' };
}

function marcarTodasNotificacionesLeidas(idUsuario) {
  const sheet = getSheet(SHEETS.NOTIFICACIONES);
  const data = getAllData(sheet);

  data.forEach((n, i) => {
    if (n.id_usuario === idUsuario && !n.leida) {
      sheet.getRange(i + 2, 7).setValue(true);
    }
  });

  return { success: true };
}

// ==================== DASHBOARD ====================

function getDashboard(idEspacio, mes, anio) {
  const mesActual = mes || (new Date().getMonth() + 1);
  const anioActual = anio || new Date().getFullYear();

  const resumen = getResumenMensual(idEspacio, mesActual, anioActual);
  const tendencia = getTendencia(idEspacio, 6);
  const topCategorias = getTopCategorias(idEspacio, mesActual, anioActual, 5);
  const cuentas = getCuentas(idEspacio);

  return {
    success: true,
    dashboard: {
      resumen: resumen.resumen,
      tendencia: tendencia.tendencia,
      top_categorias: topCategorias.categorias,
      cuentas: cuentas.cuentas,
      mes: mesActual,
      anio: anioActual
    }
  };
}

function getResumenMensual(idEspacio, mes, anio) {
  const sheet = getSheet(SHEETS.TRANSACCIONES);
  const transacciones = getAllData(sheet).filter(t => {
    const fecha = new Date(t.fecha);
    return t.id_espacio === idEspacio &&
           fecha.getMonth() + 1 == mes &&
           fecha.getFullYear() == anio;
  });

  const ingresos = transacciones
    .filter(t => t.tipo === 'ingreso')
    .reduce((sum, t) => sum + parseFloat(t.monto), 0);

  const gastos = transacciones
    .filter(t => t.tipo === 'gasto')
    .reduce((sum, t) => sum + parseFloat(t.monto), 0);

  const balance = ingresos - gastos;
  const tasaAhorro = ingresos > 0 ? ((ingresos - gastos) / ingresos) * 100 : 0;

  return {
    success: true,
    resumen: {
      ingresos: ingresos,
      gastos: gastos,
      balance: balance,
      tasa_ahorro: Math.round(tasaAhorro * 100) / 100,
      total_transacciones: transacciones.length
    }
  };
}

function getTendencia(idEspacio, meses) {
  const numMeses = meses || 6;
  const tendencia = [];
  const hoy = new Date();

  for (let i = numMeses - 1; i >= 0; i--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mes = fecha.getMonth() + 1;
    const anio = fecha.getFullYear();

    const resumen = getResumenMensual(idEspacio, mes, anio);

    tendencia.push({
      mes: mes,
      anio: anio,
      nombre_mes: getNombreMes(mes),
      ingresos: resumen.resumen.ingresos,
      gastos: resumen.resumen.gastos,
      balance: resumen.resumen.balance
    });
  }

  return { success: true, tendencia: tendencia };
}

function getNombreMes(mes) {
  const meses = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return meses[mes];
}

function getTopCategorias(idEspacio, mes, anio, limite) {
  const transSheet = getSheet(SHEETS.TRANSACCIONES);
  const catSheet = getSheet(SHEETS.CATEGORIAS);

  const transacciones = getAllData(transSheet).filter(t => {
    const fecha = new Date(t.fecha);
    return t.id_espacio === idEspacio &&
           t.tipo === 'gasto' &&
           fecha.getMonth() + 1 == mes &&
           fecha.getFullYear() == anio;
  });

  const categorias = getAllData(catSheet);

  // Agrupar por categoría
  const porCategoria = {};
  transacciones.forEach(t => {
    if (!porCategoria[t.id_categoria]) {
      porCategoria[t.id_categoria] = 0;
    }
    porCategoria[t.id_categoria] += parseFloat(t.monto);
  });

  // Calcular total
  const total = Object.values(porCategoria).reduce((sum, v) => sum + v, 0);

  // Crear lista ordenada
  let resultado = Object.entries(porCategoria).map(([idCat, monto]) => {
    const cat = categorias.find(c => c.id_categoria === idCat);
    return {
      id_categoria: idCat,
      nombre: cat?.nombre || 'Sin categoría',
      icono: cat?.icono || '📦',
      color: cat?.color || '#757575',
      monto: monto,
      porcentaje: total > 0 ? Math.round((monto / total) * 10000) / 100 : 0
    };
  });

  resultado.sort((a, b) => b.monto - a.monto);

  if (limite) {
    resultado = resultado.slice(0, parseInt(limite));
  }

  return { success: true, categorias: resultado, total: total };
}

// ==================== TRIGGERS Y AUTOMATIZACIÓN ====================

/**
 * Configura los triggers automáticos
 * Ejecutar manualmente una vez después de implementar
 */
function configurarTriggers() {
  // Eliminar triggers existentes
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));

  // Trigger diario para gastos recurrentes (a las 6am)
  ScriptApp.newTrigger('ejecutarGastosRecurrentesPendientes')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  // Trigger diario para verificar presupuestos y crear alertas
  ScriptApp.newTrigger('verificarPresupuestos')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  // Trigger diario para verificar deudas vencidas
  ScriptApp.newTrigger('verificarDeudasVencidas')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}

function verificarPresupuestos() {
  const espaciosSheet = getSheet(SHEETS.ESPACIOS);
  const presupuestosSheet = getSheet(SHEETS.PRESUPUESTOS);
  const miembrosSheet = getSheet(SHEETS.MIEMBROS_ESPACIO);

  const espacios = getAllData(espaciosSheet).filter(e => e.activo);
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  espacios.forEach(espacio => {
    const presupuestos = getAllData(presupuestosSheet).filter(p =>
      p.id_espacio === espacio.id_espacio &&
      p.mes == mesActual &&
      p.anio == anioActual &&
      p.activo
    );

    presupuestos.forEach(pres => {
      const progreso = calcularProgresoPresupuesto(pres);

      if (progreso.alerta || progreso.excedido) {
        // Obtener miembros del espacio
        const miembros = getAllData(miembrosSheet).filter(m =>
          m.id_espacio === espacio.id_espacio && m.activo
        );

        miembros.forEach(m => {
          crearNotificacion({
            id_usuario: m.id_usuario,
            tipo: 'presupuesto',
            titulo: progreso.excedido ? 'Presupuesto excedido' : 'Alerta de presupuesto',
            mensaje: `Has usado el ${progreso.porcentaje}% de tu presupuesto`,
            datos: { id_presupuesto: pres.id_presupuesto, porcentaje: progreso.porcentaje }
          });
        });
      }
    });
  });
}

function verificarDeudasVencidas() {
  const deudasSheet = getSheet(SHEETS.DEUDAS);
  const deudas = getAllData(deudasSheet).filter(d =>
    d.estado === 'pendiente' &&
    d.fecha_vencimiento
  );

  const hoy = getCurrentDate();

  deudas.forEach(deuda => {
    if (deuda.fecha_vencimiento <= hoy) {
      crearNotificacion({
        id_usuario: deuda.id_usuario,
        tipo: 'deuda',
        titulo: 'Deuda vencida',
        mensaje: `La deuda con ${deuda.persona} ha vencido`,
        datos: { id_deuda: deuda.id_deuda }
      });

      // Actualizar estado
      actualizarDeuda({
        id_deuda: deuda.id_deuda,
        estado: 'vencida'
      });
    } else {
      // Recordatorio 3 días antes
      const tresDiasAntes = new Date(deuda.fecha_vencimiento);
      tresDiasAntes.setDate(tresDiasAntes.getDate() - 3);
      const tresDiasAntesStr = Utilities.formatDate(tresDiasAntes, Session.getScriptTimeZone(), "yyyy-MM-dd");

      if (hoy === tresDiasAntesStr && deuda.recordatorio) {
        crearNotificacion({
          id_usuario: deuda.id_usuario,
          tipo: 'deuda',
          titulo: 'Recordatorio de deuda',
          mensaje: `La deuda con ${deuda.persona} vence en 3 días`,
          datos: { id_deuda: deuda.id_deuda }
        });
      }
    }
  });
}

// ==================== TEST ====================

function test() {
  // Función para probar endpoints
  Logger.log('Testing API...');

  // Test crear usuario
  const userResult = crearUsuario({
    email: 'test@example.com',
    nombre: 'Usuario Test',
    google_id: 'test123'
  });
  Logger.log('Usuario creado: ' + JSON.stringify(userResult));

  // Test dashboard
  if (userResult.success) {
    const dashResult = getDashboard(userResult.id_espacio);
    Logger.log('Dashboard: ' + JSON.stringify(dashResult));
  }
}
