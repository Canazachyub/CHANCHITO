/**
 * 16_deudas.js — deudas (me deben / debo) y sus pagos parciales. Entidad
 * sincronizable: rev/origen/eliminado y borrado lógico.
 *
 * `tipo` usa los valores del frontend (frontend/src/data/types.ts): 'me_deben' | 'debo'.
 */

var _ORIGENES_VALIDOS_DEUDA = ['app', 'bot_texto', 'bot_foto', 'migracion'];

function prepararDeuda(datos, exigirTodos) {
  datos = datos || {};

  if (exigirTodos) {
    var req = validarRequeridos(datos, ['id_espacio', 'tipo', 'persona', 'monto_original']);
    if (!req.valido) return { valido: false, error: req.error, detalle: req.detalle };
  }

  var normalizado = {};

  if (datos.tipo !== undefined) {
    var tipoV = validarTipo(datos.tipo, ['me_deben', 'debo']);
    if (!tipoV.valido) return { valido: false, error: tipoV.error, detalle: 'El tipo debe ser "me_deben" o "debo".' };
    normalizado.tipo = tipoV.valor;
  }

  if (datos.monto_original !== undefined) {
    var montoV = validarMonto(datos.monto_original);
    if (!montoV.valido) return { valido: false, error: montoV.error, detalle: montoV.detalle };
    normalizado.monto_original = montoV.valor;
    if (exigirTodos) normalizado.monto_pendiente = montoV.valor;
  }

  if (datos.fecha_vencimiento !== undefined && datos.fecha_vencimiento !== '') {
    var fechaV = validarFecha(datos.fecha_vencimiento);
    if (!fechaV.valido) return { valido: false, error: fechaV.error, detalle: fechaV.detalle };
    normalizado.fecha_vencimiento = fechaV.valor;
  }

  if (datos.estado !== undefined) {
    var estadoV = validarTipo(datos.estado, ['pendiente', 'pagada', 'vencida']);
    if (!estadoV.valido) return { valido: false, error: estadoV.error, detalle: 'estado inválido.' };
    normalizado.estado = estadoV.valor;
  }

  if (datos.origen !== undefined) {
    var origenV = validarTipo(datos.origen, _ORIGENES_VALIDOS_DEUDA);
    if (!origenV.valido) return { valido: false, error: origenV.error, detalle: 'origen inválido.' };
    normalizado.origen = origenV.valor;
  }

  // monto_pendiente se puede corregir a mano (Tablero): antes pasaba sin validar a la hoja.
  if (datos.monto_pendiente !== undefined) {
    var pendienteV = validarMonto(datos.monto_pendiente);
    if (!pendienteV.valido) return { valido: false, error: pendienteV.error, detalle: pendienteV.detalle };
    normalizado.monto_pendiente = pendienteV.valor;
  }

  // Desglose de cuota de préstamo (§ 4-quinquies): números validados como cualquier monto.
  var camposDesglose = ['capital', 'interes', 'otros'];
  for (var k = 0; k < camposDesglose.length; k++) {
    var campoD = camposDesglose[k];
    if (datos[campoD] === undefined || datos[campoD] === '') continue;
    var desgloseV = validarMonto(datos[campoD]);
    if (!desgloseV.valido) return { valido: false, error: desgloseV.error, detalle: campoD + ': ' + desgloseV.detalle };
    normalizado[campoD] = desgloseV.valor;
  }
  if (datos.nro_cuota !== undefined && datos.nro_cuota !== '') {
    var nro = parseInt(datos.nro_cuota, 10);
    if (isNaN(nro) || nro < 1) return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'nro_cuota inválido.' };
    normalizado.nro_cuota = nro;
  }

  ['id_espacio', 'id_usuario', 'id_trabajador', 'id_prestamo', 'persona', 'descripcion', 'recordatorio', 'notas'].forEach(function (campo) {
    if (datos[campo] !== undefined) normalizado[campo] = datos[campo];
  });

  return { valido: true, datos: normalizado };
}

function crearDeudaInterna(datosNormalizados, idForzado) {
  var sheet = getSheet(SHEETS.DEUDAS);
  var id = idForzado || generateId('DDA');
  var ahora = fechaHoraActual();

  var obj = {
    id_deuda: id,
    id_espacio: datosNormalizados.id_espacio,
    id_usuario: datosNormalizados.id_usuario || '',
    tipo: datosNormalizados.tipo,
    persona: sanearTexto(datosNormalizados.persona, 150),
    monto_original: datosNormalizados.monto_original,
    monto_pendiente: datosNormalizados.monto_pendiente !== undefined ? datosNormalizados.monto_pendiente : datosNormalizados.monto_original,
    descripcion: sanearTexto(datosNormalizados.descripcion, 500),
    fecha_creacion: ahora,
    fecha_vencimiento: datosNormalizados.fecha_vencimiento || '',
    estado: 'pendiente',
    recordatorio: datosNormalizados.recordatorio === true,
    notas: sanearTexto(datosNormalizados.notas, 1000),
    rev: 1,
    origen: datosNormalizados.origen || 'app',
    eliminado: false,
    fecha_modificacion: ahora,
    id_trabajador: datosNormalizados.id_trabajador || '',
    id_prestamo: datosNormalizados.id_prestamo || '',
    nro_cuota: datosNormalizados.nro_cuota || '',
    capital: datosNormalizados.capital !== undefined ? datosNormalizados.capital : '',
    interes: datosNormalizados.interes !== undefined ? datosNormalizados.interes : '',
    otros: datosNormalizados.otros !== undefined ? datosNormalizados.otros : ''
  };

  anexarFila(sheet, obj);

  return obj;
}

function actualizarDeudaInterna(fila, datosNormalizados, nuevoRev) {
  var sheet = getSheet(SHEETS.DEUDAS);
  var paraEscribir = {};
  for (var k in datosNormalizados) paraEscribir[k] = datosNormalizados[k];
  paraEscribir.rev = nuevoRev;
  paraEscribir.fecha_modificacion = fechaHoraActual();

  escribirCampos(sheet, fila.row, fila.headers, paraEscribir, ['id_deuda', 'fecha_creacion']);
  return buscarPorId(sheet, 'id_deuda', fila.datos.id_deuda).datos;
}

function eliminarDeudaInterna(fila, nuevoRev) {
  var sheet = getSheet(SHEETS.DEUDAS);
  escribirCampos(sheet, fila.row, fila.headers, { eliminado: true, rev: nuevoRev, fecha_modificacion: fechaHoraActual() }, ['id_deuda']);
  return buscarPorId(sheet, 'id_deuda', fila.datos.id_deuda).datos;
}

/**
 * Inserta la fila de PagosDeuda y actualiza la deuda (monto_pendiente, estado,
 * rev). Núcleo reutilizado por `registrarPagoDeuda` (endpoint suelto, sin
 * rev_base) y por el lote de `sincronizar` (entidad `pago_deuda`, con
 * resolución de conflicto vía rev_base) — así ninguno de los dos duplica la
 * escritura real de PagosDeuda/Deudas. No bloquea por su cuenta: el llamador
 * ya corre dentro de su propio withLock().
 */
function _aplicarPagoDeudaInterna(filaDeuda, monto, fecha, notas, idTransaccion, nuevoPendiente, nuevoEstado, nuevoRev, idPagoForzado) {
  var pagosSheet = getSheet(SHEETS.PAGOS_DEUDA);
  var idPago = idPagoForzado || generateId('PGO');

  anexarFila(pagosSheet, {
    id_pago: idPago,
    id_deuda: filaDeuda.datos.id_deuda,
    monto: monto,
    fecha: fecha,
    notas: sanearTexto(notas, 500),
    id_transaccion: idTransaccion || ''
  });

  var deudaActualizada = actualizarDeudaInterna(filaDeuda, { monto_pendiente: nuevoPendiente, estado: nuevoEstado }, nuevoRev);
  return { id_pago: idPago, deuda: deudaActualizada };
}

// ==================== ENDPOINTS ====================

function crearDeuda(datos) {
  var prep = prepararDeuda(datos, true);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  return withLock(function () {
    var creada = crearDeudaInterna(prep.datos, null);
    return respuestaExito({ id_deuda: creada.id_deuda, deuda: creada });
  });
}

function getDeudas(idEspacio, tipo, estado) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.DEUDAS);
  var deudas = getAllData(sheet).filter(function (d) { return d.id_espacio === idEspacio && !d.eliminado; });

  if (tipo) deudas = deudas.filter(function (d) { return d.tipo === tipo; });
  if (estado) deudas = deudas.filter(function (d) { return d.estado === estado; });

  deudas.sort(function (a, b) {
    if (a.fecha_creacion === b.fecha_creacion) return 0;
    return a.fecha_creacion < b.fecha_creacion ? 1 : -1;
  });

  return respuestaExito({ deudas: deudas });
}

function getDeuda(idDeuda) {
  var sheet = getSheet(SHEETS.DEUDAS);
  var fila = buscarPorId(sheet, 'id_deuda', idDeuda);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Deuda no encontrada.');

  var pagos = getAllData(getSheet(SHEETS.PAGOS_DEUDA)).filter(function (p) { return p.id_deuda === idDeuda; });
  var deuda = {};
  for (var k in fila.datos) deuda[k] = fila.datos[k];
  deuda.pagos = pagos;

  return respuestaExito({ deuda: deuda });
}

/**
 * idEspacioDeDeuda(idDeuda) → id_espacio de la deuda, o null si no existe.
 * Uso interno del router (también para getPagosDeuda, que se resuelve por deuda).
 */
function idEspacioDeDeuda(idDeuda) {
  var fila = buscarPorId(getSheet(SHEETS.DEUDAS), 'id_deuda', idDeuda);
  return fila ? fila.datos.id_espacio : null;
}

function actualizarDeuda(datos) {
  var req = validarRequeridos(datos, ['id_deuda']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var prep = prepararDeuda(datos, false);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  var sheet = getSheet(SHEETS.DEUDAS);
  var fila = buscarPorId(sheet, 'id_deuda', datos.id_deuda);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Deuda no encontrada.');

  return withLock(function () {
    var nuevoRev = siguienteRev(fila.datos.rev);
    var actualizado = actualizarDeudaInterna(fila, prep.datos, nuevoRev);
    return respuestaExito({ deuda: actualizado });
  });
}

function eliminarDeuda(idDeuda) {
  var sheet = getSheet(SHEETS.DEUDAS);
  var fila = buscarPorId(sheet, 'id_deuda', idDeuda);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Deuda no encontrada.');

  return withLock(function () {
    var nuevoRev = siguienteRev(fila.datos.rev);
    eliminarDeudaInterna(fila, nuevoRev);
    return respuestaExito({ id_deuda: idDeuda });
  });
}

function registrarPagoDeuda(datos) {
  var req = validarRequeridos(datos, ['id_deuda', 'monto']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var montoV = validarMonto(datos.monto);
  if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);

  var deudaSheet = getSheet(SHEETS.DEUDAS);
  var fila = buscarPorId(deudaSheet, 'id_deuda', datos.id_deuda);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Deuda no encontrada.');

  var fechaPago = fechaActual();
  if (datos.fecha) {
    var fechaV = validarFecha(datos.fecha);
    if (!fechaV.valido) return respuestaError(fechaV.error, fechaV.detalle);
    fechaPago = fechaV.valor;
  }

  return withLock(function () {
    var montoPendienteActual = parseFloat(fila.datos.monto_pendiente) || 0;
    var nuevoPendiente = Math.max(0, montoPendienteActual - montoV.valor);
    var nuevoEstado = nuevoPendiente <= 0 ? 'pagada' : fila.datos.estado;
    var nuevoRev = siguienteRev(fila.datos.rev);

    var resultado = _aplicarPagoDeudaInterna(
      fila, montoV.valor, fechaPago, datos.notas, datos.id_transaccion,
      nuevoPendiente, nuevoEstado, nuevoRev, null
    );

    return respuestaExito({ id_pago: resultado.id_pago, monto_pendiente: nuevoPendiente, estado: nuevoEstado });
  });
}

function getPagosDeuda(idDeuda) {
  var sheet = getSheet(SHEETS.PAGOS_DEUDA);
  var pagos = getAllData(sheet).filter(function (p) { return p.id_deuda === idDeuda; });
  return respuestaExito({ pagos: pagos });
}
