/**
 * 02_util.js — utilidades compartidas: respuesta JSON, acceso a hojas, ids,
 * fechas, bloqueo de escritura y reporte de errores.
 */

// ==================== RESPUESTA HTTP ====================

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function respuestaExito(data) {
  return { success: true, data: data === undefined ? {} : data };
}

function respuestaError(codigo, detalle) {
  return { success: false, error: codigo, detalle: detalle || '' };
}

// ==================== HOJAS ====================

function getSheet(nombre) {
  var ss = SpreadsheetApp.openById(getProp('SPREADSHEET_ID'));
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    var headers = ESQUEMA_COLUMNAS[nombre];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function obtenerEncabezados(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

/** Busca la fila (1-based) cuya columna `columnaIndex` (0-based) sea igual a `valor`. -1 si no existe. */
function findRow(sheet, valor, columnaIndex) {
  var col = columnaIndex === undefined ? 0 : columnaIndex;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][col] == valor) return i + 1;
  }
  return -1;
}

function getFilaObjeto(sheet, row, headers) {
  var values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  var obj = {};
  for (var i = 0; i < headers.length; i++) obj[headers[i]] = normalizarValorCelda(headers[i], values[i]);
  return obj;
}

function getAllData(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === '' || data[i][0] === null) continue; // fila en blanco
    var obj = {};
    // Sheets devuelve Date donde el backend escribió texto: ver normalizarValorCelda (lib_filas.js).
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = normalizarValorCelda(headers[j], data[i][j]);
    result.push(obj);
  }
  return result;
}

/**
 * Busca una fila por su columna id. Devuelve { row, headers, datos } o null.
 * `idCampo` es el nombre de columna (p.ej. 'id_usuario'); si no existe en los
 * encabezados se asume que es la primera columna.
 */
function buscarPorId(sheet, idCampo, idValor) {
  if (!idValor) return null;
  var headers = obtenerEncabezados(sheet);
  var col = headers.indexOf(idCampo);
  if (col < 0) col = 0;
  var row = findRow(sheet, idValor, col);
  if (row < 0) return null;
  return { row: row, headers: headers, datos: getFilaObjeto(sheet, row, headers) };
}

/**
 * anexarFila(sheet, datos) — agrega una fila nueva en el orden REAL de
 * columnas de `sheet` (obtenerEncabezados), no el de ESQUEMA_COLUMNAS
 * (00_config.js). Es la única función que debe llamar a `sheet.appendRow`
 * directamente en todo el backend: un `appendRow([...])` posicional armado
 * con el orden de ESQUEMA_COLUMNAS escribe en la columna equivocada apenas
 * la hoja fue migrada (`_asegurarColumnas` agrega columnas faltantes al
 * final, así que el orden real diverge del esquema) — bug de corrupción de
 * datos ya confirmado en producción.
 *
 * `datos` es un objeto { nombre_columna: valor }; las columnas del esquema
 * ausentes en `datos` quedan como ''. Una clave de `datos` que no es ningún
 * encabezado real de la hoja es un error de programación: se reporta a
 * Sentry y la escritura sigue igual (mejor una fila con un campo de menos
 * que perder la escritura entera). El cálculo del orden es puro — ver
 * construirFilaOrdenada en lib_filas.js.
 */
function anexarFila(sheet, datos) {
  var headers = obtenerEncabezados(sheet);
  var resultado = construirFilaOrdenada(headers, datos);

  resultado.clavesDesconocidas.forEach(function (clave) {
    reportarSentry(
      new Error('anexarFila: "' + clave + '" no es una columna de la hoja "' + sheet.getName() + '".'),
      { hoja: sheet.getName(), clave: clave }
    );
  });

  sheet.appendRow(resultado.valores);
}

/** Escribe en `sheet`/`row` los campos presentes en `datos`, salvo los `protegidos`. */
function escribirCampos(sheet, row, headers, datos, protegidos) {
  var prot = protegidos || [];
  var valoresActuales = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  var cambiaron = false;
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (datos[h] !== undefined && prot.indexOf(h) === -1) {
      valoresActuales[i] = datos[h];
      cambiaron = true;
    }
  }
  if (cambiaron) {
    sheet.getRange(row, 1, 1, headers.length).setValues([valoresActuales]);
  }
}

// ==================== IDS Y FECHAS ====================

function generateId(prefijo) {
  return prefijo + '_' + Utilities.getUuid().substring(0, 8);
}

function fechaHoraActual() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function fechaActual() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ==================== BLOQUEO DE ESCRITURA ====================

/**
 * Ejecuta `fn` bajo LockService.getScriptLock(). Un intento de 10s y un
 * reintento de 10s más; si ambos fallan devuelve { success:false, error:'LOCK_TIMEOUT' }
 * y `fn` nunca se ejecuta (evita escrituras parciales).
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  var obtuvoLock = lock.tryLock(10000);
  if (!obtuvoLock) {
    obtuvoLock = lock.tryLock(10000);
  }
  if (!obtuvoLock) {
    return respuestaError('LOCK_TIMEOUT', 'El sistema está ocupado procesando otro cambio. Intenta de nuevo en unos segundos.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ==================== ERRORES Y MONITOREO ====================

/** Registra un error del backend en Notificaciones (tipo='sistema'). Nunca lanza. */
function registrarErrorSistema(mensaje, contexto) {
  try {
    var sheet = getSheet(SHEETS.NOTIFICACIONES);
    anexarFila(sheet, {
      id_notificacion: generateId('NTF'),
      id_usuario: 'SISTEMA',
      tipo: 'sistema',
      titulo: 'Error del backend',
      mensaje: String(mensaje).substring(0, 500),
      datos: JSON.stringify(contexto || {}).substring(0, 1000),
      canal: 'app',
      leida: false,
      fecha_creacion: fechaHoraActual()
    });
  } catch (error) {
    // Si ni siquiera se puede registrar el error, no hay más que hacer aquí.
  }
}

/** POST al DSN de Sentry. Envuelto en try/catch: un fallo de Sentry nunca tumba el request. */
function reportarSentry(error, contexto) {
  try {
    var dsn = PropertiesService.getScriptProperties().getProperty('SENTRY_DSN_BACKEND');
    if (!dsn) return;
    UrlFetchApp.fetch(dsn, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        mensaje: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : '',
        contexto: contexto || {},
        fecha: fechaHoraActual()
      })
    });
  } catch (e) {
    // Nunca tumbar el request por un fallo al reportar a Sentry.
  }
}

/**
 * action=logError — endpoint de log del frontend (checklist § 11 del README).
 * No requiere validación de campos: cualquier detalle es mejor que nada.
 */
function logError(datos) {
  var mensaje = (datos && datos.mensaje) || 'Error sin mensaje reportado por el cliente';
  registrarErrorSistema(mensaje, datos || {});
  reportarSentry(new Error(mensaje), datos || {});
  return respuestaExito({});
}
