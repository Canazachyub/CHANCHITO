/**
 * 13_categorias.js — categorías de gasto/ingreso, por espacio. Las de sistema
 * (es_sistema=true) no se pueden editar ni eliminar. `grupo` agrupa
 * visualmente una lista larga (Telcom); en Familia queda vacío (§ 6-bis).
 */

function crearCategoria(datos) {
  var validacion = validarRequeridos(datos, ['nombre', 'tipo', 'id_espacio']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var tipoValidacion = validarTipo(datos.tipo, ['gasto', 'ingreso']);
  if (!tipoValidacion.valido) return respuestaError(tipoValidacion.error, 'El tipo debe ser "gasto" o "ingreso".');

  return withLock(function () {
    var sheet = getSheet(SHEETS.CATEGORIAS);
    var id = generateId('CAT');

    anexarFila(sheet, {
      id_categoria: id,
      id_espacio: datos.id_espacio,
      nombre: sanearTexto(datos.nombre, 100),
      tipo: tipoValidacion.valor,
      icono: sanearTexto(datos.icono, 10) || '📦',
      color: sanearTexto(datos.color, 20) || '#86868B',
      es_sistema: datos.es_sistema === true,
      grupo: sanearTexto(datos.grupo, 50) || '',
      orden: parseInt(datos.orden, 10) || 0,
      activo: true
    });

    return respuestaExito({ id_categoria: id });
  });
}

/** getCategorias(idEspacio, tipo?, grupo?) — grupo filtra visualmente (§ 6-bis). */
function getCategorias(idEspacio, tipo, grupo) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.CATEGORIAS);
  var categorias = getAllData(sheet).filter(function (c) { return c.id_espacio === idEspacio && c.activo; });

  if (tipo) {
    categorias = categorias.filter(function (c) { return c.tipo === tipo; });
  }
  if (grupo) {
    categorias = categorias.filter(function (c) { return c.grupo === grupo; });
  }

  categorias.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });

  return respuestaExito({ categorias: categorias });
}

function getCategoria(idCategoria) {
  var sheet = getSheet(SHEETS.CATEGORIAS);
  var fila = buscarPorId(sheet, 'id_categoria', idCategoria);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Categoría no encontrada.');
  return respuestaExito({ categoria: fila.datos });
}

/**
 * idEspacioDeCategoria(idCategoria) → id_espacio de la categoría, o null si no
 * existe. Uso interno del router para la guardia de pertenencia.
 */
function idEspacioDeCategoria(idCategoria) {
  var fila = buscarPorId(getSheet(SHEETS.CATEGORIAS), 'id_categoria', idCategoria);
  return fila ? fila.datos.id_espacio : null;
}

function actualizarCategoria(datos) {
  var validacion = validarRequeridos(datos, ['id_categoria']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var sheet = getSheet(SHEETS.CATEGORIAS);
  var fila = buscarPorId(sheet, 'id_categoria', datos.id_categoria);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Categoría no encontrada.');

  if (fila.datos.es_sistema) {
    return respuestaError('SIN_PERMISO', 'No se puede editar una categoría del sistema.');
  }

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, datos, ['id_categoria', 'es_sistema']);
    return respuestaExito({ id_categoria: datos.id_categoria });
  });
}

/** Borrado lógico (activo=false). */
function eliminarCategoria(idCategoria) {
  var sheet = getSheet(SHEETS.CATEGORIAS);
  var fila = buscarPorId(sheet, 'id_categoria', idCategoria);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Categoría no encontrada.');

  if (fila.datos.es_sistema) {
    return respuestaError('SIN_PERMISO', 'No se puede eliminar una categoría del sistema.');
  }

  return withLock(function () {
    sheet.getRange(fila.row, fila.headers.indexOf('activo') + 1).setValue(false);
    return respuestaExito({ id_categoria: idCategoria });
  });
}

/**
 * Uso interno desde 91_setup.js — crea las categorías de sistema del espacio
 * dado, según su catálogo en CATEGORIAS_SISTEMA (00_config.js, docs/CONTRACT.md
 * § 6-bis). Idempotente por nombre+tipo dentro del espacio.
 */
function crearCategoriasSistemaInterno(idEspacio) {
  var sheet = getSheet(SHEETS.CATEGORIAS);
  var existentes = getAllData(sheet).filter(function (c) { return c.id_espacio === idEspacio; });
  var catalogo = CATEGORIAS_SISTEMA[idEspacio];
  if (!catalogo) return;

  function crearSiNoExiste(c, tipo, orden) {
    var yaExiste = existentes.some(function (e) { return e.nombre === c.nombre && e.tipo === tipo; });
    if (yaExiste) return;
    anexarFila(sheet, {
      id_categoria: generateId('CAT'),
      id_espacio: idEspacio,
      nombre: c.nombre,
      tipo: tipo,
      icono: c.icono,
      color: c.color,
      es_sistema: true,
      grupo: c.grupo || '',
      orden: orden,
      activo: true
    });
  }

  (catalogo.gasto || []).forEach(function (c, i) { crearSiNoExiste(c, 'gasto', i); });
  (catalogo.ingreso || []).forEach(function (c, i) { crearSiNoExiste(c, 'ingreso', i); });
}
