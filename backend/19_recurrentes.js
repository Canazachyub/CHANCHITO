/**
 * 19_recurrentes.js — gastos recurrentes (suscripciones, alquiler, etc).
 * No es una entidad sincronizable (§ 4): borrado lógico vía `activo`, como el legacy.
 */

function calcularProximaEjecucion(frecuencia, diaEjecucion) {
  var hoy = new Date();
  var proxima = new Date();

  switch (frecuencia) {
    case 'diario':
      proxima.setDate(hoy.getDate() + 1);
      break;
    case 'semanal':
      proxima.setDate(hoy.getDate() + ((7 - hoy.getDay() + diaEjecucion) % 7));
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

  return Utilities.formatDate(proxima, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function crearGastoRecurrente(datos) {
  var validacion = validarRequeridos(datos, ['id_espacio', 'id_categoria', 'id_cuenta', 'descripcion', 'monto', 'frecuencia']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var frecuenciaV = validarTipo(datos.frecuencia, ['diario', 'semanal', 'mensual', 'anual']);
  if (!frecuenciaV.valido) return respuestaError(frecuenciaV.error, 'La frecuencia debe ser diario, semanal, mensual o anual.');

  var montoV = validarMonto(datos.monto);
  if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);

  return withLock(function () {
    var sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
    var id = generateId('GRC');
    var diaEjecucion = parseInt(datos.dia_ejecucion, 10) || 1;

    anexarFila(sheet, {
      id_gasto_recurrente: id,
      id_espacio: datos.id_espacio,
      id_categoria: datos.id_categoria,
      id_cuenta: datos.id_cuenta,
      descripcion: sanearTexto(datos.descripcion, 300),
      monto: montoV.valor,
      frecuencia: frecuenciaV.valor,
      dia_ejecucion: diaEjecucion,
      proximo_ejecucion: calcularProximaEjecucion(frecuenciaV.valor, diaEjecucion),
      activo: true,
      fecha_creacion: fechaHoraActual()
    });

    return respuestaExito({ id_gasto_recurrente: id });
  });
}

function getGastosRecurrentes(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  var gastos = getAllData(sheet).filter(function (g) { return g.id_espacio === idEspacio && g.activo; });

  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var cuentas = getAllData(getSheet(SHEETS.CUENTAS));

  gastos = gastos.map(function (g) {
    var categoria = categorias.filter(function (c) { return c.id_categoria === g.id_categoria; })[0];
    var cuenta = cuentas.filter(function (c) { return c.id_cuenta === g.id_cuenta; })[0];
    var enriquecido = {};
    for (var k in g) enriquecido[k] = g[k];
    enriquecido.categoria_nombre = categoria ? categoria.nombre : null;
    enriquecido.categoria_icono = categoria ? categoria.icono : null;
    enriquecido.cuenta_nombre = cuenta ? cuenta.nombre : null;
    return enriquecido;
  });

  return respuestaExito({ gastos_recurrentes: gastos });
}

/**
 * idEspacioDeGastoRecurrente(idGastoRecurrente) → id_espacio, o null.
 * Uso interno del router.
 */
function idEspacioDeGastoRecurrente(idGastoRecurrente) {
  var fila = buscarPorId(getSheet(SHEETS.GASTOS_RECURRENTES), 'id_gasto_recurrente', idGastoRecurrente);
  return fila ? fila.datos.id_espacio : null;
}

function actualizarGastoRecurrente(datos) {
  var validacion = validarRequeridos(datos, ['id_gasto_recurrente']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  if (datos.monto !== undefined) {
    var montoV = validarMonto(datos.monto);
    if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);
    datos.monto = montoV.valor;
  }

  var sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  var fila = buscarPorId(sheet, 'id_gasto_recurrente', datos.id_gasto_recurrente);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Gasto recurrente no encontrado.');

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, datos, ['id_gasto_recurrente', 'fecha_creacion']);
    return respuestaExito({ id_gasto_recurrente: datos.id_gasto_recurrente });
  });
}

function eliminarGastoRecurrente(idGastoRecurrente) {
  var sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  var fila = buscarPorId(sheet, 'id_gasto_recurrente', idGastoRecurrente);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Gasto recurrente no encontrado.');

  return withLock(function () {
    sheet.getRange(fila.row, fila.headers.indexOf('activo') + 1).setValue(false);
    return respuestaExito({ id_gasto_recurrente: idGastoRecurrente });
  });
}

/** Genera la transacción de un gasto recurrente y avanza su próxima ejecución. */
function ejecutarGastoRecurrente(idGastoRecurrente) {
  var sheet = getSheet(SHEETS.GASTOS_RECURRENTES);
  var fila = buscarPorId(sheet, 'id_gasto_recurrente', idGastoRecurrente);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Gasto recurrente no encontrado.');

  return withLock(function () {
    var gasto = fila.datos;

    var transaccion = crearTransaccionInterna({
      id_espacio: gasto.id_espacio,
      id_usuario: '',
      id_cuenta: gasto.id_cuenta,
      id_categoria: gasto.id_categoria,
      tipo: 'gasto',
      monto: parseFloat(gasto.monto) || 0,
      descripcion: gasto.descripcion + ' (recurrente)',
      notas: 'Generado automáticamente',
      origen: 'app'
    }, null);

    var proximaEjecucion = calcularProximaEjecucion(gasto.frecuencia, gasto.dia_ejecucion);
    sheet.getRange(fila.row, fila.headers.indexOf('proximo_ejecucion') + 1).setValue(proximaEjecucion);

    return respuestaExito({ id_transaccion: transaccion.id_transaccion });
  });
}

// Nota: la orquestación diaria de qué recurrentes ejecutar (recorrer todos los
// `activo` con proximo_ejecucion <= hoy) es responsabilidad de backend/50_triggers.js
// (otro agente). Este archivo solo expone ejecutarGastoRecurrente(id) para un gasto puntual.
