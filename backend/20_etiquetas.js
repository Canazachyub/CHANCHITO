/**
 * 20_etiquetas.js — etiquetas libres para transacciones (muchos a muchos).
 */

function crearEtiqueta(datos) {
  var validacion = validarRequeridos(datos, ['nombre', 'id_espacio']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  return withLock(function () {
    var sheet = getSheet(SHEETS.ETIQUETAS);
    var id = generateId('ETQ');

    anexarFila(sheet, {
      id_etiqueta: id,
      id_espacio: datos.id_espacio,
      nombre: sanearTexto(datos.nombre, 60),
      color: sanearTexto(datos.color, 20) || '#86868B'
    });

    return respuestaExito({ id_etiqueta: id });
  });
}

function getEtiquetas(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.ETIQUETAS);
  var etiquetas = getAllData(sheet).filter(function (e) { return e.id_espacio === idEspacio; });
  return respuestaExito({ etiquetas: etiquetas });
}

/**
 * idEspacioDeEtiqueta(idEtiqueta) → id_espacio de la etiqueta, o null.
 * Uso interno del router.
 */
function idEspacioDeEtiqueta(idEtiqueta) {
  var fila = buscarPorId(getSheet(SHEETS.ETIQUETAS), 'id_etiqueta', idEtiqueta);
  return fila ? fila.datos.id_espacio : null;
}

function eliminarEtiqueta(idEtiqueta) {
  var sheet = getSheet(SHEETS.ETIQUETAS);
  var fila = buscarPorId(sheet, 'id_etiqueta', idEtiqueta);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Etiqueta no encontrada.');

  return withLock(function () {
    var relSheet = getSheet(SHEETS.TRANSACCION_ETIQUETAS);
    var relData = getAllData(relSheet);
    for (var i = relData.length - 1; i >= 0; i--) {
      if (relData[i].id_etiqueta === idEtiqueta) {
        relSheet.deleteRow(i + 2);
      }
    }

    sheet.deleteRow(fila.row);
    return respuestaExito({ id_etiqueta: idEtiqueta });
  });
}

function asignarEtiqueta(idTransaccion, idEtiqueta) {
  var validacion = validarRequeridos({ id_transaccion: idTransaccion, id_etiqueta: idEtiqueta }, ['id_transaccion', 'id_etiqueta']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  return withLock(function () {
    var sheet = getSheet(SHEETS.TRANSACCION_ETIQUETAS);
    var existentes = getAllData(sheet);
    var yaExiste = existentes.some(function (r) { return r.id_transaccion === idTransaccion && r.id_etiqueta === idEtiqueta; });

    if (yaExiste) return respuestaError('CAMPO_REQUERIDO', 'La etiqueta ya está asignada a esta transacción.');

    anexarFila(sheet, {
      id: generateId('TEQ'),
      id_transaccion: idTransaccion,
      id_etiqueta: idEtiqueta
    });
    return respuestaExito({});
  });
}

function removerEtiqueta(idTransaccion, idEtiqueta) {
  return withLock(function () {
    var sheet = getSheet(SHEETS.TRANSACCION_ETIQUETAS);
    var data = getAllData(sheet);

    for (var i = 0; i < data.length; i++) {
      if (data[i].id_transaccion === idTransaccion && data[i].id_etiqueta === idEtiqueta) {
        sheet.deleteRow(i + 2);
        return respuestaExito({});
      }
    }

    return respuestaError('NO_ENCONTRADO', 'Esa etiqueta no estaba asignada a la transacción.');
  });
}
