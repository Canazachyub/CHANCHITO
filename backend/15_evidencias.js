/**
 * 15_evidencias.js — fotos de voucher / comprobantes en Drive, ligadas a una transacción.
 * No es una entidad sincronizable (§ 4): mantiene deleteRow físico, como el legacy.
 */

function subirEvidencia(datos) {
  var validacion = validarRequeridos(datos, ['id_transaccion', 'contenido_base64', 'nombre_archivo']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var transaccion = buscarPorId(getSheet(SHEETS.TRANSACCIONES), 'id_transaccion', datos.id_transaccion);
  if (!transaccion || transaccion.datos.eliminado) {
    return respuestaError('NO_ENCONTRADO', 'La transacción para esta evidencia no existe.');
  }

  return withLock(function () {
    try {
      var folder = DriveApp.getFolderById(getProp('DRIVE_FOLDER_ID'));
      var blob = Utilities.newBlob(
        Utilities.base64Decode(datos.contenido_base64),
        datos.mime_type || 'image/jpeg',
        sanearTexto(datos.nombre_archivo, 200)
      );

      var archivo = folder.createFile(blob);
      archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var url = archivo.getUrl();
      var sheet = getSheet(SHEETS.EVIDENCIAS);
      var id = generateId('EVD');

      anexarFila(sheet, {
        id_evidencia: id,
        id_transaccion: datos.id_transaccion,
        tipo: sanearTexto(datos.tipo, 30) || 'imagen',
        url: url,
        nombre_archivo: sanearTexto(datos.nombre_archivo, 200),
        tamano: datos.tamano || blob.getBytes().length,
        fecha_subida: fechaHoraActual()
      });

      return respuestaExito({ id_evidencia: id, url: url, file_id: archivo.getId() });
    } catch (error) {
      return respuestaError('ERROR_INTERNO', 'Error al subir el archivo a Drive: ' + error.toString());
    }
  });
}

function getEvidencias(idTransaccion) {
  var sheet = getSheet(SHEETS.EVIDENCIAS);
  var evidencias = getAllData(sheet).filter(function (e) { return e.id_transaccion === idTransaccion; });
  return respuestaExito({ evidencias: evidencias });
}

/**
 * idEspacioDeEvidencia(idEvidencia) → id_espacio de la transacción a la que
 * pertenece la evidencia, o null. Uso interno del router.
 */
function idEspacioDeEvidencia(idEvidencia) {
  var fila = buscarPorId(getSheet(SHEETS.EVIDENCIAS), 'id_evidencia', idEvidencia);
  if (!fila) return null;
  return idEspacioDeTransaccion(fila.datos.id_transaccion);
}

function eliminarEvidencia(idEvidencia) {
  var sheet = getSheet(SHEETS.EVIDENCIAS);
  var fila = buscarPorId(sheet, 'id_evidencia', idEvidencia);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Evidencia no encontrada.');

  return withLock(function () {
    try {
      var m = String(fila.datos.url || '').match(/[-\w]{25,}/);
      if (m) DriveApp.getFileById(m[0]).setTrashed(true);
    } catch (error) {
      // El archivo ya pudo haber sido borrado de Drive: no es un error fatal.
    }

    sheet.deleteRow(fila.row);
    return respuestaExito({ id_evidencia: idEvidencia });
  });
}
