/**
 * lib_obligaciones.js — lógica pura de las obligaciones mensuales (CONTRACT.md § 4-ter).
 *
 * Sin SpreadsheetApp: recibe valores y decide, para que la idempotencia del trigger diario
 * sea testeable. Es lo único que impide que la planilla del mes se genere veinte veces —
 * el trigger corre todos los días sobre las mismas obligaciones.
 */

/** 'yyyy-MM' de una fecha (objeto Date o string 'yyyy-MM-dd'). */
function periodoActual(fecha) {
  if (typeof fecha === 'string') return fecha.slice(0, 7);
  var mes = fecha.getMonth() + 1;
  return fecha.getFullYear() + '-' + (mes < 10 ? '0' + mes : String(mes));
}

/**
 * ¿Hay que generar la deuda de este período? Solo si nunca se generó o si cambió el mes.
 * Comparar strings 'yyyy-MM' y no fechas evita depender de la hora, la zona horaria y de
 * cuántas veces corrió el trigger hoy.
 */
function debeGenerarPeriodo(ultimoPeriodoGenerado, periodo) {
  if (!ultimoPeriodoGenerado) return true;
  // 'yyyy-MM' ordena bien como texto. Con "distinto" (la versión anterior), una obligación
  // adelantada (la cuota de noviembre ya cargada a mano) generaba igual la de octubre.
  return String(ultimoPeriodoGenerado).slice(0, 7) < String(periodo).slice(0, 7);
}

if (typeof module !== 'undefined') {
  module.exports = { periodoActual: periodoActual, debeGenerarPeriodo: debeGenerarPeriodo };
}
