/**
 * 21_notificaciones.js — notificaciones internas (presupuesto, deuda, recurrente,
 * sistema, transferencia) y su canal (app | telegram).
 */

var _TIPOS_NOTIFICACION = ['presupuesto', 'deuda', 'recurrente', 'sistema', 'transferencia', 'solicitud', 'obligacion'];
var _CANALES_NOTIFICACION = ['app', 'telegram'];

/** Uso interno: lo llaman otros dominios (deudas, presupuestos, telegram, triggers). */
function crearNotificacionInterna(datos) {
  var sheet = getSheet(SHEETS.NOTIFICACIONES);
  var id = generateId('NTF');

  var tipoV = validarTipo(datos.tipo, _TIPOS_NOTIFICACION);
  var canalV = validarTipo(datos.canal || 'app', _CANALES_NOTIFICACION);

  anexarFila(sheet, {
    id_notificacion: id,
    id_usuario: datos.id_usuario,
    tipo: tipoV.valido ? tipoV.valor : 'sistema',
    titulo: sanearTexto(datos.titulo, 150),
    mensaje: sanearTexto(datos.mensaje, 500),
    datos: JSON.stringify(datos.datos || {}),
    canal: canalV.valido ? canalV.valor : 'app',
    leida: false,
    fecha_creacion: fechaHoraActual()
  });

  return id;
}

function getNotificaciones(idUsuario, leida) {
  var sheet = getSheet(SHEETS.NOTIFICACIONES);
  var notificaciones = getAllData(sheet).filter(function (n) { return n.id_usuario === idUsuario; });

  if (leida !== undefined && leida !== null && leida !== '') {
    var leidaBool = leida === 'true' || leida === true;
    notificaciones = notificaciones.filter(function (n) { return n.leida === leidaBool; });
  }

  notificaciones = notificaciones.map(function (n) {
    var enriquecida = {};
    for (var k in n) enriquecida[k] = n[k];
    try {
      enriquecida.datos = JSON.parse(n.datos || '{}');
    } catch (error) {
      enriquecida.datos = {};
    }
    return enriquecida;
  });

  notificaciones.sort(function (a, b) {
    if (a.fecha_creacion === b.fecha_creacion) return 0;
    return a.fecha_creacion < b.fecha_creacion ? 1 : -1;
  });

  return respuestaExito({ notificaciones: notificaciones });
}

function marcarNotificacionLeida(idNotificacion) {
  var sheet = getSheet(SHEETS.NOTIFICACIONES);
  var fila = buscarPorId(sheet, 'id_notificacion', idNotificacion);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Notificación no encontrada.');

  return withLock(function () {
    sheet.getRange(fila.row, fila.headers.indexOf('leida') + 1).setValue(true);
    return respuestaExito({ id_notificacion: idNotificacion });
  });
}

function marcarTodasLeidas(idUsuario) {
  if (!idUsuario) return respuestaError('CAMPO_REQUERIDO', 'falta: id_usuario');

  return withLock(function () {
    var sheet = getSheet(SHEETS.NOTIFICACIONES);
    var data = getAllData(sheet);
    var headers = obtenerEncabezados(sheet);
    var colLeida = headers.indexOf('leida');

    data.forEach(function (n, i) {
      if (n.id_usuario === idUsuario && !n.leida) {
        sheet.getRange(i + 2, colLeida + 1).setValue(true);
      }
    });

    return respuestaExito({});
  });
}
