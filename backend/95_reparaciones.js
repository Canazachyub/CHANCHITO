/**
 * 95_reparaciones.js — arreglos puntuales de datos, para correr una vez desde el editor.
 *
 * repararCuotasPrestamos(): el 2026-10-14 la importación generó cuotas de octubre para los
 * préstamos de cuota fija aunque su próxima cuota real era de noviembre (o ya estaba cargada).
 * Causas, ya corregidas: Sheets devolvía el período como fecha (normalizarValorCelda) y la regla
 * del período comparaba por "distinto" en vez de "anterior" (debeGenerarPeriodo).
 *
 * Por cada préstamo con obligación enlazada:
 *  - anula (borrado lógico) las cuotas GENERADAS AUTOMÁTICAMENTE que caen antes de la primera
 *    cuota cargada a mano, o en el mismo mes que una cuota cargada a mano (duplicadas);
 *  - deja ultimo_periodo_generado en el último mes que ya tiene cuota.
 * Idempotente: correrla de nuevo no cambia nada. `dryRun` (por defecto true en el atajo de prueba).
 */

var REP_PREFIJO_GENERADA = 'Generada automáticamente';

function rep_periodo(fecha) {
  return String(normalizarValorCelda('fecha_vencimiento', fecha) || '').slice(0, 7);
}

function repararCuotasPrestamos(dryRun) {
  var ejecutar = function () {
    var ahora = fechaHoraActual();
    var oblSheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
    var deudasSheet = getSheet(SHEETS.DEUDAS);
    var deudas = getAllData(deudasSheet);
    var log = [];

    getAllData(oblSheet).forEach(function (o) {
      if (!o.id_prestamo || o.eliminado) return;
      var cuotas = deudas.filter(function (d) { return d.id_prestamo === o.id_prestamo && !d.eliminado; });
      var manuales = cuotas.filter(function (d) { return String(d.notas || '').indexOf(REP_PREFIJO_GENERADA) !== 0; });
      var primeraManual = manuales.map(function (d) { return rep_periodo(d.fecha_vencimiento); }).sort()[0] || '';
      var periodosManuales = manuales.map(function (d) { return rep_periodo(d.fecha_vencimiento); });

      var quedan = [];
      cuotas.forEach(function (d) {
        var periodo = rep_periodo(d.fecha_vencimiento);
        var generada = manuales.indexOf(d) === -1;
        var sobra = generada && primeraManual && (periodo < primeraManual || periodosManuales.indexOf(periodo) !== -1);
        if (!sobra) { quedan.push(periodo); return; }
        log.push('Anular cuota generada de ' + o.concepto + ' · vence ' + normalizarValorCelda('fecha_vencimiento', d.fecha_vencimiento) + ' · S/ ' + d.monto_pendiente);
        if (dryRun) return;
        var f = buscarPorId(deudasSheet, 'id_deuda', d.id_deuda);
        escribirCampos(deudasSheet, f.row, f.headers, { eliminado: true, rev: (parseInt(d.rev, 10) || 1) + 1, fecha_modificacion: ahora }, ['id_deuda']);
      });

      var ultimo = quedan.sort().pop() || '';
      if (ultimo && ultimo !== String(o.ultimo_periodo_generado)) {
        log.push(o.concepto + ': último período generado ' + o.ultimo_periodo_generado + ' → ' + ultimo);
        if (!dryRun) {
          var fo = buscarPorId(oblSheet, 'id_obligacion', o.id_obligacion);
          // Con apóstrofo: Sheets lo guarda como texto y no lo convierte en fecha.
          escribirCampos(oblSheet, fo.row, fo.headers, { ultimo_periodo_generado: "'" + ultimo, fecha_modificacion: ahora }, ['id_obligacion']);
        }
      }
    });

    if (log.length === 0) log.push('Nada que reparar.');
    return log;
  };
  return dryRun ? ejecutar() : withLock(ejecutar);
}

function reparacionPrueba() {
  var log = repararCuotasPrestamos(true);
  Logger.log('MODO PRUEBA (no escribe nada):\n' + log.join('\n'));
  return log;
}

function reparacionAplicar() {
  var log = repararCuotasPrestamos(false);
  Logger.log(log.join('\n'));
  return log;
}
