/**
 * lib_calculos.js — PURO. Nada de SpreadsheetApp ni servicios de Google aquí.
 * Firmas exactas — docs/CONTRACT.md § "Firmas obligatorias de la lógica pura".
 */

/**
 * calcularBalance(transacciones, saldoInicial) → number
 * ingreso suma, gasto resta. Ignora filas con eliminado=true.
 */
function calcularBalance(transacciones, saldoInicial) {
  var balance = parseFloat(saldoInicial) || 0;
  (transacciones || []).forEach(function (t) {
    if (!t || t.eliminado) return;
    var monto = parseFloat(t.monto) || 0;
    if (t.tipo === 'ingreso') balance += monto;
    else if (t.tipo === 'gasto') balance -= monto;
  });
  return balance;
}

/**
 * calcularResumenMensual(transacciones, mes, anio) → { total_ingresos, total_gastos, saldo }
 * `fecha` se espera en formato 'yyyy-MM-dd...'.
 */
function calcularResumenMensual(transacciones, mes, anio) {
  var totalIngresos = 0;
  var totalGastos = 0;

  (transacciones || []).forEach(function (t) {
    if (!t || t.eliminado || !t.fecha) return;
    var partes = String(t.fecha).split('-');
    var anioT = parseInt(partes[0], 10);
    var mesT = parseInt(partes[1], 10);
    if (mesT !== Number(mes) || anioT !== Number(anio)) return;

    var monto = parseFloat(t.monto) || 0;
    if (t.tipo === 'ingreso') totalIngresos += monto;
    else if (t.tipo === 'gasto') totalGastos += monto;
  });

  return {
    total_ingresos: totalIngresos,
    total_gastos: totalGastos,
    saldo: totalIngresos - totalGastos
  };
}

/**
 * calcularProgresoPresupuesto(limite, gastado) → { gastado, limite, porcentaje, excedido, restante }
 */
function calcularProgresoPresupuesto(limite, gastado) {
  var lim = parseFloat(limite) || 0;
  var gas = parseFloat(gastado) || 0;
  var porcentaje = lim > 0 ? Math.round((gas / lim) * 10000) / 100 : 0;

  return {
    gastado: gas,
    limite: lim,
    porcentaje: porcentaje,
    excedido: gas > lim,
    restante: lim - gas
  };
}

/**
 * agruparPorCategoria(transacciones, categorias) → array ordenado desc por total,
 * cada elemento con `proporcion` 0..1 respecto del total agrupado.
 */
function agruparPorCategoria(transacciones, categorias) {
  var totales = {};
  var total = 0;

  (transacciones || []).forEach(function (t) {
    if (!t || t.eliminado) return;
    var monto = parseFloat(t.monto) || 0;
    var idCat = t.id_categoria || '';
    totales[idCat] = (totales[idCat] || 0) + monto;
    total += monto;
  });

  var lista = Object.keys(totales).map(function (idCat) {
    var categoria = (categorias || []).filter(function (c) { return c && c.id_categoria === idCat; })[0];
    return {
      id_categoria: idCat,
      nombre: categoria ? categoria.nombre : 'Sin categoría',
      icono: categoria ? categoria.icono : '📦',
      color: categoria ? categoria.color : '#86868B',
      total: totales[idCat],
      proporcion: total > 0 ? totales[idCat] / total : 0
    };
  });

  lista.sort(function (a, b) { return b.total - a.total; });
  return lista;
}

/**
 * calcularTendencia(transacciones, meses, hoy) → array de { mes, anio, ingresos, gastos }
 * `hoy` es inyectable para test (Date o string parseable).
 */
function calcularTendencia(transacciones, meses, hoy) {
  var numMeses = meses || 6;
  var fechaHoy = hoy ? new Date(hoy) : new Date();
  var resultado = [];

  for (var i = numMeses - 1; i >= 0; i--) {
    var fecha = new Date(fechaHoy.getFullYear(), fechaHoy.getMonth() - i, 1);
    var mes = fecha.getMonth() + 1;
    var anio = fecha.getFullYear();
    var resumen = calcularResumenMensual(transacciones, mes, anio);
    resultado.push({ mes: mes, anio: anio, ingresos: resumen.total_ingresos, gastos: resumen.total_gastos });
  }

  return resultado;
}

/**
 * Interpreta 'yyyy-MM-dd' como fecha LOCAL (no UTC). `new Date('yyyy-MM-dd')`
 * de JS la interpreta como UTC medianoche, lo que corre el día en zonas
 * horarias negativas — por eso no se usa directo acá ni en validarFecha.
 */
function _parsearFechaLocal(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]') return valor;
  var texto = String(valor).trim();
  var m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(texto);
}

/**
 * diasHastaVencimiento(fechaVencimiento, hoy) → entero, negativo si ya venció.
 */
function diasHastaVencimiento(fechaVencimiento, hoy) {
  if (!fechaVencimiento) return NaN;
  var venc = _parsearFechaLocal(fechaVencimiento);
  var base = hoy ? _parsearFechaLocal(hoy) : new Date();
  if (isNaN(venc.getTime()) || isNaN(base.getTime())) return NaN;

  var vencUTC = Date.UTC(venc.getFullYear(), venc.getMonth(), venc.getDate());
  var baseUTC = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((vencUTC - baseUTC) / 86400000);
}

/**
 * Fecha de vencimiento de una obligación mensual (CONTRACT.md § 4-ter), como 'yyyy-MM-dd'.
 *
 * Si el día configurado (29, 30, 31) no existe en ese mes, se recorta al último día real.
 * Es la razón de que esta función exista en vez de hacer la cuenta al vuelo: en JavaScript
 * `new Date(2026, 1, 31)` no falla ni avisa, devuelve el 3 de marzo — y la planilla de
 * febrero vencería en marzo sin que nadie lo note hasta que llega el recargo.
 */
function resolverFechaVencimientoMensual(diaVencimiento, mes, anio) {
  // Día 0 del mes siguiente = último día de este mes. Sirve para bisiestos sin casos especiales.
  var ultimoDia = new Date(anio, mes, 0).getDate();
  var dia = Math.min(Math.max(parseInt(diaVencimiento, 10) || 1, 1), ultimoDia);

  var mm = mes < 10 ? '0' + mes : String(mes);
  var dd = dia < 10 ? '0' + dia : String(dia);
  return anio + '-' + mm + '-' + dd;
}

if (typeof module !== 'undefined') {
  module.exports = {
    calcularBalance: calcularBalance,
    calcularResumenMensual: calcularResumenMensual,
    calcularProgresoPresupuesto: calcularProgresoPresupuesto,
    agruparPorCategoria: agruparPorCategoria,
    calcularTendencia: calcularTendencia,
    diasHastaVencimiento: diasHastaVencimiento,
    resolverFechaVencimientoMensual: resolverFechaVencimientoMensual
  };
}
