/**
 * lib_solicitudes.js — lógica pura de las solicitudes de dinero (CONTRACT.md § 4-bis).
 *
 * Sin SpreadsheetApp ni ningún servicio de Google: recibe la fila y devuelve la decisión,
 * igual que lib_sync.js. Así el guardián contra la doble aprobación —lo único que impide
 * que dos toques al botón de Telegram creen dos gastos— es testeable sin desplegar nada.
 *
 * Quien escribe (23_solicitudes.js) es responsable de llamar a `puedeResponderSolicitud`
 * y de aplicar el resultado DENTRO del mismo lock que usa para releer el estado. Estas
 * funciones deciden; no protegen por sí solas de una condición de carrera.
 */

var _ESTADO_SOLICITUD_ABIERTA = 'solicitada';

/**
 * ¿Se puede responder esta solicitud? Solo si sigue abierta.
 * → { valido: bool, error?: 'SOLICITUD_YA_RESPONDIDA', detalle?: string }
 */
function puedeResponderSolicitud(solicitud) {
  if (!solicitud) {
    return { valido: false, error: 'NO_ENCONTRADO', detalle: 'La solicitud no existe.' };
  }
  if (solicitud.eliminado === true) {
    return { valido: false, error: 'NO_ENCONTRADO', detalle: 'La solicitud fue eliminada.' };
  }
  if (solicitud.estado !== _ESTADO_SOLICITUD_ABIERTA) {
    return {
      valido: false,
      error: 'SOLICITUD_YA_RESPONDIDA',
      detalle: 'Esta solicitud ya fue ' + solicitud.estado + '.'
    };
  }
  return { valido: true };
}

/**
 * Resuelve la respuesta del propietario.
 * `contexto`: { id_aprobador, fecha_respuesta, origen }.
 *
 * → { estado: 'rechazado', error: 'SOLICITUD_YA_RESPONDIDA' }        si ya estaba respondida
 * → { estado: 'aprobada', crearTransaccion: true, datosTransaccion, campos }
 * → { estado: 'rechazada', crearTransaccion: false, campos }
 *
 * `campos` son los valores a escribir en la fila de SolicitudesDinero; `datosTransaccion`
 * es lo que hay que pasarle a crearTransaccionInterna. Aprobar ES entregar (§ 4-bis):
 * no hay estado intermedio de "enviado".
 */
function resolverRespuestaSolicitud(solicitud, aprobar, contexto) {
  var guarda = puedeResponderSolicitud(solicitud);
  if (!guarda.valido) {
    return { estado: 'rechazado', error: guarda.error, detalle: guarda.detalle };
  }

  var ctx = contexto || {};
  var campos = {
    estado: aprobar ? 'aprobada' : 'rechazada',
    id_aprobador: ctx.id_aprobador || '',
    fecha_respuesta: ctx.fecha_respuesta || '',
    fecha_modificacion: ctx.fecha_respuesta || ''
  };

  if (!aprobar) {
    if (ctx.motivo) campos.notas = ctx.motivo;
    return { estado: 'rechazada', crearTransaccion: false, campos: campos };
  }

  return {
    estado: 'aprobada',
    crearTransaccion: true,
    campos: campos,
    datosTransaccion: {
      id_espacio: solicitud.id_espacio,
      // El gasto queda a nombre de quien pidió la plata, no de quien la autorizó:
      // el dinero lo gastó el solicitante, y así se ve en su columna del resumen.
      id_usuario: solicitud.id_solicitante,
      id_categoria: solicitud.id_categoria,
      tipo: 'gasto',
      monto: solicitud.monto,
      descripcion: solicitud.motivo,
      origen: ctx.origen || 'app'
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { puedeResponderSolicitud: puedeResponderSolicitud, resolverRespuestaSolicitud: resolverRespuestaSolicitud };
}
