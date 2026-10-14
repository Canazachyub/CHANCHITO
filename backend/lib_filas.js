/**
 * lib_filas.js — PURO. Nada de SpreadsheetApp ni servicios de Google aquí.
 *
 * Ordena los valores de un objeto `datos` según el orden REAL de columnas de
 * una hoja, no el de ESQUEMA_COLUMNAS (00_config.js). Existe por el bug de
 * corrupción de datos confirmado en producción: `_asegurarColumnas`
 * (91_setup.js) agrega al final las columnas que falten en una hoja
 * preexistente — a propósito, para no romper la data legacy — así que en una
 * hoja migrada el orden real de columnas puede NO coincidir con el orden de
 * ESQUEMA_COLUMNAS. Un `sheet.appendRow([...])` posicional armado con ese
 * segundo orden escribe cada valor en la columna equivocada. `anexarFila`
 * (backend/02_util.js) es la única función que debe usar `sheet.appendRow`
 * directamente para insertar filas nuevas; usa esta función pura para decidir
 * el orden.
 */

/**
 * construirFilaOrdenada(headersReales, datos) → { valores, clavesDesconocidas }
 *
 * `headersReales`: array de encabezados tal cual están en la fila 1 de la
 * hoja (obtenerEncabezados(sheet) — NO ESQUEMA_COLUMNAS). `datos`: objeto
 * { nombre_columna: valor }.
 *
 * `valores[i]` corresponde a `headersReales[i]`: si `datos` no trae esa
 * columna (por ejemplo una columna del esquema que la hoja todavía no
 * tiene), va ''. `clavesDesconocidas` junta las claves de `datos` que no son
 * ningún encabezado real de la hoja — típicamente un error de programación
 * (nombre de columna mal tipeado) — el llamador decide qué hacer con eso
 * (reportar a Sentry, etc.); esta función nunca lanza y nunca deja de
 * calcular `valores` por eso.
 */
function construirFilaOrdenada(headersReales, datos) {
  var headers = headersReales || [];
  var fuente = datos || {};

  var valores = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(fuente, h) ? fuente[h] : '';
  });

  var clavesDesconocidas = Object.keys(fuente).filter(function (k) {
    return headers.indexOf(k) === -1;
  });

  return { valores: valores, clavesDesconocidas: clavesDesconocidas };
}

/** Columnas que guardan fecha Y hora ('yyyy-MM-dd HH:mm:ss') aunque la hora sea 00:00:00. */
var CAMPOS_FECHA_HORA = ['fecha_creacion', 'fecha_modificacion', 'fecha_registro', 'ultima_sesion', 'fecha_solicitud',
  'fecha_respuesta', 'fecha_subida', 'fecha_union', 'password_actualizado'];

/**
 * normalizarValorCelda(header, valor) → el valor como lo escribió el backend.
 *
 * Google Sheets convierte por su cuenta los textos con forma de fecha: '2026-10' pasa a ser
 * 1 de octubre, '2026-11-04' una fecha y '17:17:36' una hora del 30/12/1899. Al leer, getValues()
 * devuelve objetos Date, y toda comparación de texto contra ellos falla en silencio: el
 * generador de obligaciones creía que nunca había generado el mes, la purga nunca purgaba y
 * el JSON viajaba al cliente con zona horaria ('2026-11-04T05:00:00.000Z').
 * Los Date se vuelven a texto según la columna; el resto pasa igual.
 */
function normalizarValorCelda(header, valor) {
  if (Object.prototype.toString.call(valor) !== '[object Date]' || isNaN(valor.getTime())) return valor;
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = valor.getFullYear() + '-' + p2(valor.getMonth() + 1) + '-' + p2(valor.getDate());
  var hms = p2(valor.getHours()) + ':' + p2(valor.getMinutes()) + ':' + p2(valor.getSeconds());
  if (header === 'ultimo_periodo_generado') return ymd.slice(0, 7);
  if (header === 'hora') return hms;
  if (CAMPOS_FECHA_HORA.indexOf(header) !== -1) return ymd + ' ' + hms;
  return hms === '00:00:00' ? ymd : ymd + ' ' + hms;
}

if (typeof module !== 'undefined') {
  module.exports = { construirFilaOrdenada: construirFilaOrdenada, normalizarValorCelda: normalizarValorCelda };
}
