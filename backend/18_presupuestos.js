/**
 * 18_presupuestos.js — límites de gasto por categoría/mes. Entidad sincronizable:
 * rev/origen/eliminado y borrado lógico. `activo` sigue existiendo por separado
 * para poder pausar un presupuesto sin borrarlo.
 */

var _ORIGENES_VALIDOS_PRESUPUESTO = ['app', 'bot_texto', 'bot_foto', 'migracion'];

function prepararPresupuesto(datos, exigirTodos) {
  datos = datos || {};

  if (exigirTodos) {
    var req = validarRequeridos(datos, ['id_espacio', 'id_categoria', 'monto_limite', 'mes', 'anio']);
    if (!req.valido) return { valido: false, error: req.error, detalle: req.detalle };
  }

  var normalizado = {};

  if (datos.monto_limite !== undefined) {
    var montoV = validarMonto(datos.monto_limite);
    if (!montoV.valido) return { valido: false, error: montoV.error, detalle: montoV.detalle };
    normalizado.monto_limite = montoV.valor;
  }

  if (datos.mes !== undefined) {
    var mes = parseInt(datos.mes, 10);
    if (isNaN(mes) || mes < 1 || mes > 12) {
      return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'El mes debe estar entre 1 y 12.' };
    }
    normalizado.mes = mes;
  }

  if (datos.anio !== undefined) {
    var anio = parseInt(datos.anio, 10);
    if (isNaN(anio) || anio < 2000) {
      return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'El año no es válido.' };
    }
    normalizado.anio = anio;
  }

  if (datos.origen !== undefined) {
    var origenV = validarTipo(datos.origen, _ORIGENES_VALIDOS_PRESUPUESTO);
    if (!origenV.valido) return { valido: false, error: origenV.error, detalle: 'origen inválido.' };
    normalizado.origen = origenV.valor;
  }

  ['id_espacio', 'id_categoria', 'alerta_porcentaje', 'activo'].forEach(function (campo) {
    if (datos[campo] !== undefined) normalizado[campo] = datos[campo];
  });

  return { valido: true, datos: normalizado };
}

function crearPresupuestoInterna(datosNormalizados, idForzado) {
  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  var id = idForzado || generateId('PRE');

  var obj = {
    id_presupuesto: id,
    id_espacio: datosNormalizados.id_espacio,
    id_categoria: datosNormalizados.id_categoria,
    monto_limite: datosNormalizados.monto_limite,
    mes: datosNormalizados.mes,
    anio: datosNormalizados.anio,
    alerta_porcentaje: datosNormalizados.alerta_porcentaje || 80,
    activo: true,
    rev: 1,
    origen: datosNormalizados.origen || 'app',
    eliminado: false,
    fecha_modificacion: fechaHoraActual()
  };

  anexarFila(sheet, obj);

  return obj;
}

function actualizarPresupuestoInterna(fila, datosNormalizados, nuevoRev) {
  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  var paraEscribir = {};
  for (var k in datosNormalizados) paraEscribir[k] = datosNormalizados[k];
  paraEscribir.rev = nuevoRev;
  paraEscribir.fecha_modificacion = fechaHoraActual();

  escribirCampos(sheet, fila.row, fila.headers, paraEscribir, ['id_presupuesto']);
  return buscarPorId(sheet, 'id_presupuesto', fila.datos.id_presupuesto).datos;
}

function eliminarPresupuestoInterna(fila, nuevoRev) {
  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  escribirCampos(sheet, fila.row, fila.headers, { eliminado: true, rev: nuevoRev, fecha_modificacion: fechaHoraActual() }, ['id_presupuesto']);
  return buscarPorId(sheet, 'id_presupuesto', fila.datos.id_presupuesto).datos;
}

// ==================== ENDPOINTS ====================

function crearPresupuesto(datos) {
  var prep = prepararPresupuesto(datos, true);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  return withLock(function () {
    var creado = crearPresupuestoInterna(prep.datos, null);
    return respuestaExito({ id_presupuesto: creado.id_presupuesto, presupuesto: creado });
  });
}

function getPresupuestos(idEspacio, mes, anio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  var presupuestos = getAllData(sheet).filter(function (p) { return p.id_espacio === idEspacio && p.activo && !p.eliminado; });

  if (mes) presupuestos = presupuestos.filter(function (p) { return Number(p.mes) === Number(mes); });
  if (anio) presupuestos = presupuestos.filter(function (p) { return Number(p.anio) === Number(anio); });

  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES));

  presupuestos = presupuestos.map(function (p) {
    var categoria = categorias.filter(function (c) { return c.id_categoria === p.id_categoria; })[0];
    var gastoDelMes = calcularResumenGastoCategoria(transacciones, p.id_categoria, p.mes, p.anio);
    var progreso = calcularProgresoPresupuesto(p.monto_limite, gastoDelMes);

    var enriquecido = {};
    for (var k in p) enriquecido[k] = p[k];
    enriquecido.categoria_nombre = categoria ? categoria.nombre : null;
    enriquecido.categoria_icono = categoria ? categoria.icono : null;
    enriquecido.categoria_color = categoria ? categoria.color : null;
    enriquecido.gastado = progreso.gastado;
    enriquecido.porcentaje = progreso.porcentaje;
    enriquecido.excedido = progreso.excedido;
    return enriquecido;
  });

  return respuestaExito({ presupuestos: presupuestos });
}

function calcularResumenGastoCategoria(transacciones, idCategoria, mes, anio) {
  return transacciones
    .filter(function (t) {
      if (t.eliminado || t.tipo !== 'gasto' || t.id_categoria !== idCategoria || !t.fecha) return false;
      var partes = String(t.fecha).split('-');
      return parseInt(partes[1], 10) === Number(mes) && parseInt(partes[0], 10) === Number(anio);
    })
    .reduce(function (suma, t) { return suma + (parseFloat(t.monto) || 0); }, 0);
}

function getProgresoPresupuesto(idPresupuesto) {
  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  var fila = buscarPorId(sheet, 'id_presupuesto', idPresupuesto);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Presupuesto no encontrado.');

  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES));
  var gastado = calcularResumenGastoCategoria(transacciones, fila.datos.id_categoria, fila.datos.mes, fila.datos.anio);
  var progreso = calcularProgresoPresupuesto(fila.datos.monto_limite, gastado);

  return respuestaExito(progreso);
}

/**
 * idEspacioDePresupuesto(idPresupuesto) → id_espacio del presupuesto, o null.
 * Uso interno del router.
 */
function idEspacioDePresupuesto(idPresupuesto) {
  var fila = buscarPorId(getSheet(SHEETS.PRESUPUESTOS), 'id_presupuesto', idPresupuesto);
  return fila ? fila.datos.id_espacio : null;
}

function actualizarPresupuesto(datos) {
  var req = validarRequeridos(datos, ['id_presupuesto']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var prep = prepararPresupuesto(datos, false);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  var fila = buscarPorId(sheet, 'id_presupuesto', datos.id_presupuesto);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Presupuesto no encontrado.');

  return withLock(function () {
    var nuevoRev = siguienteRev(fila.datos.rev);
    var actualizado = actualizarPresupuestoInterna(fila, prep.datos, nuevoRev);
    return respuestaExito({ presupuesto: actualizado });
  });
}

function eliminarPresupuesto(idPresupuesto) {
  var sheet = getSheet(SHEETS.PRESUPUESTOS);
  var fila = buscarPorId(sheet, 'id_presupuesto', idPresupuesto);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Presupuesto no encontrado.');

  return withLock(function () {
    var nuevoRev = siguienteRev(fila.datos.rev);
    eliminarPresupuestoInterna(fila, nuevoRev);
    return respuestaExito({ id_presupuesto: idPresupuesto });
  });
}
