/**
 * 14_transacciones.js — CRUD de transacciones (gasto/ingreso). Entidad sincronizable:
 * lleva rev/origen/eliminado y borrado lógico.
 *
 * Cada acción pública (crear/actualizar/eliminar) valida y luego llama a
 * withLock(). Las variantes "*Interna" no validan ni bloquean: las usa
 * 30_sincronizar.js dentro de su propio lock de lote.
 */

var _ORIGENES_VALIDOS = ['app', 'bot_texto', 'bot_foto', 'migracion'];

/**
 * Valida y normaliza los campos de una transacción. `exigirTodos=true` para
 * creación (todos los campos obligatorios presentes); false para edición
 * parcial (solo valida lo que venga presente).
 */
function prepararTransaccion(datos, exigirTodos) {
  datos = datos || {};

  if (exigirTodos) {
    var req = validarRequeridos(datos, ['id_espacio', 'id_cuenta', 'id_categoria', 'tipo', 'monto']);
    if (!req.valido) return { valido: false, error: req.error, detalle: req.detalle };
  }

  var normalizado = {};

  if (datos.tipo !== undefined) {
    var tipoV = validarTipo(datos.tipo, ['gasto', 'ingreso']);
    if (!tipoV.valido) return { valido: false, error: tipoV.error, detalle: 'El tipo debe ser "gasto" o "ingreso".' };
    normalizado.tipo = tipoV.valor;
  }

  if (datos.monto !== undefined) {
    var montoV = validarMonto(datos.monto);
    if (!montoV.valido) return { valido: false, error: montoV.error, detalle: montoV.detalle };
    normalizado.monto = montoV.valor;
  }

  if (datos.fecha !== undefined && datos.fecha !== '') {
    var fechaV = validarFecha(datos.fecha);
    if (!fechaV.valido) return { valido: false, error: fechaV.error, detalle: fechaV.detalle };
    normalizado.fecha = fechaV.valor;
  }

  if (datos.origen !== undefined) {
    var origenV = validarTipo(datos.origen, _ORIGENES_VALIDOS);
    if (!origenV.valido) return { valido: false, error: origenV.error, detalle: 'origen inválido.' };
    normalizado.origen = origenV.valor;
  }

  ['id_espacio', 'id_usuario', 'id_cuenta', 'id_categoria', 'descripcion', 'hora', 'ubicacion', 'notas'].forEach(function (campo) {
    if (datos[campo] !== undefined) normalizado[campo] = datos[campo];
  });

  return { valido: true, datos: normalizado };
}

/** Escribe una fila nueva. `idForzado` la usa 30_sincronizar.js (el cliente genera el id en "crear"). */
function crearTransaccionInterna(datosNormalizados, idForzado) {
  var sheet = getSheet(SHEETS.TRANSACCIONES);
  var id = idForzado || generateId('TRX');
  var ahora = fechaHoraActual();
  var fecha = datosNormalizados.fecha || fechaActual();
  var hora = datosNormalizados.hora || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');

  var obj = {
    id_transaccion: id,
    id_espacio: datosNormalizados.id_espacio,
    id_usuario: datosNormalizados.id_usuario || '',
    id_cuenta: datosNormalizados.id_cuenta,
    id_categoria: datosNormalizados.id_categoria,
    tipo: datosNormalizados.tipo,
    monto: datosNormalizados.monto,
    descripcion: sanearTexto(datosNormalizados.descripcion, 300),
    fecha: fecha,
    hora: hora,
    ubicacion: sanearTexto(datosNormalizados.ubicacion, 200),
    notas: sanearTexto(datosNormalizados.notas, 1000),
    rev: 1,
    origen: datosNormalizados.origen || 'app',
    eliminado: false,
    fecha_creacion: ahora,
    fecha_modificacion: ahora
  };

  anexarFila(sheet, obj);

  return obj;
}

function actualizarTransaccionInterna(fila, datosNormalizados, nuevoRev) {
  var sheet = getSheet(SHEETS.TRANSACCIONES);
  var paraEscribir = {};
  for (var k in datosNormalizados) paraEscribir[k] = datosNormalizados[k];
  paraEscribir.rev = nuevoRev;
  paraEscribir.fecha_modificacion = fechaHoraActual();

  escribirCampos(sheet, fila.row, fila.headers, paraEscribir, ['id_transaccion', 'fecha_creacion']);
  return buscarPorId(sheet, 'id_transaccion', fila.datos.id_transaccion).datos;
}

function eliminarTransaccionInterna(fila, nuevoRev) {
  var sheet = getSheet(SHEETS.TRANSACCIONES);
  escribirCampos(sheet, fila.row, fila.headers, { eliminado: true, rev: nuevoRev, fecha_modificacion: fechaHoraActual() }, ['id_transaccion']);
  return buscarPorId(sheet, 'id_transaccion', fila.datos.id_transaccion).datos;
}

// ==================== ENDPOINTS ====================

function crearTransaccion(datos) {
  var prep = prepararTransaccion(datos, true);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  return withLock(function () {
    var creada = crearTransaccionInterna(prep.datos, null);
    return respuestaExito({ id_transaccion: creada.id_transaccion, transaccion: creada });
  });
}

function getTransacciones(idEspacio, fechaInicio, fechaFin, tipo, idCategoria, idCuenta) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.TRANSACCIONES);
  var transacciones = getAllData(sheet).filter(function (t) { return t.id_espacio === idEspacio && !t.eliminado; });

  if (fechaInicio) transacciones = transacciones.filter(function (t) { return t.fecha >= fechaInicio; });
  if (fechaFin) transacciones = transacciones.filter(function (t) { return t.fecha <= fechaFin; });
  if (tipo) transacciones = transacciones.filter(function (t) { return t.tipo === tipo; });
  if (idCategoria) transacciones = transacciones.filter(function (t) { return t.id_categoria === idCategoria; });
  if (idCuenta) transacciones = transacciones.filter(function (t) { return t.id_cuenta === idCuenta; });

  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var cuentas = getAllData(getSheet(SHEETS.CUENTAS));

  transacciones = transacciones.map(function (t) {
    var categoria = categorias.filter(function (c) { return c.id_categoria === t.id_categoria; })[0];
    var cuenta = cuentas.filter(function (c) { return c.id_cuenta === t.id_cuenta; })[0];
    var enriquecida = {};
    for (var k in t) enriquecida[k] = t[k];
    enriquecida.categoria_nombre = categoria ? categoria.nombre : null;
    enriquecida.categoria_icono = categoria ? categoria.icono : null;
    enriquecida.categoria_color = categoria ? categoria.color : null;
    enriquecida.cuenta_nombre = cuenta ? cuenta.nombre : null;
    enriquecida.cuenta_icono = cuenta ? cuenta.icono : null;
    return enriquecida;
  });

  transacciones.sort(function (a, b) {
    var claveA = a.fecha + ' ' + (a.hora || '');
    var claveB = b.fecha + ' ' + (b.hora || '');
    if (claveA === claveB) return 0;
    return claveA < claveB ? 1 : -1;
  });

  return respuestaExito({ transacciones: transacciones });
}

function getTransaccion(idTransaccion) {
  var sheet = getSheet(SHEETS.TRANSACCIONES);
  var fila = buscarPorId(sheet, 'id_transaccion', idTransaccion);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Transacción no encontrada.');

  var evidencias = getAllData(getSheet(SHEETS.EVIDENCIAS)).filter(function (e) { return e.id_transaccion === idTransaccion; });
  var transaccion = {};
  for (var k in fila.datos) transaccion[k] = fila.datos[k];
  transaccion.evidencias = evidencias;

  return respuestaExito({ transaccion: transaccion });
}

/**
 * actualizarTransaccion — cualquier usuario activo puede editar transacciones
 * de otro (billetera compartida); queda registrado en fecha_modificacion.
 */
function actualizarTransaccion(datos) {
  var req = validarRequeridos(datos, ['id_transaccion']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var prep = prepararTransaccion(datos, false);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  var sheet = getSheet(SHEETS.TRANSACCIONES);
  var fila = buscarPorId(sheet, 'id_transaccion', datos.id_transaccion);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Transacción no encontrada.');

  return withLock(function () {
    var nuevoRev = siguienteRev(fila.datos.rev);
    var actualizado = actualizarTransaccionInterna(fila, prep.datos, nuevoRev);
    return respuestaExito({ transaccion: actualizado });
  });
}

function eliminarTransaccion(idTransaccion) {
  var sheet = getSheet(SHEETS.TRANSACCIONES);
  var fila = buscarPorId(sheet, 'id_transaccion', idTransaccion);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Transacción no encontrada.');

  return withLock(function () {
    var nuevoRev = siguienteRev(fila.datos.rev);
    eliminarTransaccionInterna(fila, nuevoRev);
    return respuestaExito({ id_transaccion: idTransaccion });
  });
}

/**
 * idEspacioDeTransaccion(idTransaccion) → id_espacio de la transacción, o null
 * si no existe. Uso interno del router y de 15_evidencias.js/20_etiquetas.js
 * para resolver la guardia de pertenencia en acciones que reciben
 * id_transaccion en vez de id_espacio directo.
 */
function idEspacioDeTransaccion(idTransaccion) {
  var fila = buscarPorId(getSheet(SHEETS.TRANSACCIONES), 'id_transaccion', idTransaccion);
  return fila ? fila.datos.id_espacio : null;
}
