/**
 * 22_dashboard.js — agregados de solo lectura para las pantallas de Resumen.
 * Envuelve la lógica pura de lib_calculos.js con datos reales de Sheets.
 */

var _NOMBRES_MES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function getResumenMensual(idEspacio, mes, anio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var mesNum = Number(mes) || (new Date().getMonth() + 1);
  var anioNum = Number(anio) || new Date().getFullYear();

  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES)).filter(function (t) {
    return t.id_espacio === idEspacio && !t.eliminado;
  });
  var transaccionesDelMes = transacciones.filter(function (t) {
    if (!t.fecha) return false;
    var partes = String(t.fecha).split('-');
    return parseInt(partes[0], 10) === anioNum && parseInt(partes[1], 10) === mesNum;
  });

  var resumen = calcularResumenMensual(transacciones, mesNum, anioNum);
  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var gastosDelMes = transaccionesDelMes.filter(function (t) { return t.tipo === 'gasto'; });
  var porCategoria = agruparPorCategoria(gastosDelMes, categorias);

  var presupuestos = getAllData(getSheet(SHEETS.PRESUPUESTOS)).filter(function (p) {
    return p.id_espacio === idEspacio && !p.eliminado && p.activo && Number(p.mes) === mesNum && Number(p.anio) === anioNum;
  });

  porCategoria.forEach(function (c) {
    var presupuesto = presupuestos.filter(function (p) { return p.id_categoria === c.id_categoria; })[0];
    if (presupuesto) c.limite = parseFloat(presupuesto.monto_limite) || 0;
  });

  return respuestaExito({
    mes: mesNum,
    anio: anioNum,
    total_ingresos: resumen.total_ingresos,
    total_gastos: resumen.total_gastos,
    saldo: resumen.saldo,
    por_categoria: porCategoria
  });
}

function getTendencia(idEspacio, meses) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var numMeses = parseInt(meses, 10) || 6;

  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES)).filter(function (t) {
    return t.id_espacio === idEspacio && !t.eliminado;
  });

  var tendencia = calcularTendencia(transacciones, numMeses, new Date());
  tendencia.forEach(function (item) { item.nombre_mes = _NOMBRES_MES[item.mes]; });

  return respuestaExito({ tendencia: tendencia });
}

function getTopCategorias(idEspacio, mes, anio, limite) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var mesNum = Number(mes) || (new Date().getMonth() + 1);
  var anioNum = Number(anio) || new Date().getFullYear();

  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES)).filter(function (t) {
    if (t.eliminado || t.id_espacio !== idEspacio || t.tipo !== 'gasto' || !t.fecha) return false;
    var partes = String(t.fecha).split('-');
    return parseInt(partes[0], 10) === anioNum && parseInt(partes[1], 10) === mesNum;
  });

  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var agrupado = agruparPorCategoria(transacciones, categorias);

  var lim = parseInt(limite, 10);
  if (lim > 0) agrupado = agrupado.slice(0, lim);

  var total = agrupado.reduce(function (suma, c) { return suma + c.total; }, 0);

  return respuestaExito({ categorias: agrupado, total: total });
}

function getDashboard(idEspacio, mes, anio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var mesNum = Number(mes) || (new Date().getMonth() + 1);
  var anioNum = Number(anio) || new Date().getFullYear();

  var resumen = getResumenMensual(idEspacio, mesNum, anioNum);
  var tendencia = getTendencia(idEspacio, 6);
  var topCategorias = getTopCategorias(idEspacio, mesNum, anioNum, 5);
  var cuentas = getCuentas(idEspacio);

  return respuestaExito({
    resumen: resumen.data,
    tendencia: tendencia.data.tendencia,
    top_categorias: topCategorias.data.categorias,
    cuentas: cuentas.data.cuentas,
    mes: mesNum,
    anio: anioNum
  });
}
