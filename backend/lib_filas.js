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

if (typeof module !== 'undefined') {
  module.exports = { construirFilaOrdenada: construirFilaOrdenada };
}
