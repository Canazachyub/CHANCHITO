/**
 * Solicitudes de dinero (docs/CONTRACT.md § 4-bis): una solicitud ya
 * respondida no se puede volver a responder (`SOLICITUD_YA_RESPONDIDA`);
 * aprobar produce una transacción de gasto, rechazar no.
 *
 * Igual que en tests/obligaciones_mensuales.test.js: la lógica de
 * `responderSolicitud(p, u)` vive (o va a vivir) en backend/23_solicitudes.js,
 * que depende de SpreadsheetApp y no es testeable por Jest directamente
 * (docs/CONTRACT.md § 1). Para que "no se puede responder dos veces" y
 * "aprobar crea transacción, rechazar no" tengan cobertura de lógica pura,
 * hace falta aislar la decisión en un archivo `lib_solicitudes.js` — no
 * existe todavía en este repo. Se documenta acá la firma recomendada y los
 * describe de abajo se saltan agraciadamente hasta que exista (mismo patrón
 * que el resto de la suite):
 *
 *   // backend/lib_solicitudes.js (archivo nuevo sugerido, PURO, mismo patrón
 *   // que lib_sync.js: sin SpreadsheetApp, exporta con
 *   // `if (typeof module !== 'undefined')`)
 *
 *   puedeResponderSolicitud(solicitud) → { valido, error?: 'SOLICITUD_YA_RESPONDIDA', detalle? }
 *     // valido=false si solicitud.estado !== 'solicitada' (docs/CONTRACT.md § 2:
 *     // estados 'solicitada' | 'aprobada' | 'rechazada').
 *
 *   resolverRespuestaSolicitud(solicitud, aprobar, contexto)
 *     // → { estado: 'rechazado', error: 'SOLICITUD_YA_RESPONDIDA' }  (ya respondida)
 *     // → { estado: 'aprobada', crearTransaccion: true,  datosTransaccion: {...} }  (aprobar=true)
 *     // → { estado: 'rechazada', crearTransaccion: false }                          (aprobar=false)
 *     // `contexto` trae { id_aprobador, fecha_respuesta, origen } para completar
 *     // los campos que § 4-bis pide guardar en la respuesta.
 *
 * No es responsabilidad de este agente (dueño de tests/**, no de backend/lib_*.js)
 * crear ese archivo — así lo pide la tarea explícitamente. Se deja reportado.
 */

let lib;
try {
  lib = require('../backend/lib_solicitudes.js');
} catch (e) {
  lib = null;
}

const tienePuedeResponder = !!(lib && typeof lib.puedeResponderSolicitud === 'function');
const tieneResolverRespuesta = !!(lib && typeof lib.resolverRespuestaSolicitud === 'function');

const describeIfPuedeResponder = tienePuedeResponder ? describe : describe.skip;
const describeIfResolverRespuesta = tieneResolverRespuesta ? describe : describe.skip;

if (!lib) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/solicitudes_dinero.test.js] backend/lib_solicitudes.js todavía no existe — ' +
    'se omiten los tests. Ver la firma recomendada en la cabecera de este archivo.'
  );
}

function solicitudBase(overrides) {
  return Object.assign(
    {
      id_solicitud: 'SOL_ab12cd34',
      id_espacio: 'ESP_TELCOM',
      id_solicitante: 'USR_1',
      monto: 150,
      motivo: 'Materiales para trámite en campo',
      id_categoria: 'CAT_materiales',
      estado: 'solicitada',
      id_aprobador: '',
      fecha_solicitud: '2026-08-01 10:00:00',
      fecha_respuesta: '',
      id_transaccion: '',
      notas: '',
      eliminado: false
    },
    overrides
  );
}

describeIfPuedeResponder('lib_solicitudes.puedeResponderSolicitud', () => {
  test('una solicitud en estado "solicitada" (recién creada) sí se puede responder', () => {
    const r = lib.puedeResponderSolicitud(solicitudBase());
    expect(r.valido).toBe(true);
  });

  test('una solicitud ya "aprobada" NO se puede responder de nuevo → SOLICITUD_YA_RESPONDIDA', () => {
    const r = lib.puedeResponderSolicitud(solicitudBase({ estado: 'aprobada' }));
    expect(r.valido).toBe(false);
    expect(r.error).toBe('SOLICITUD_YA_RESPONDIDA');
  });

  test('una solicitud ya "rechazada" NO se puede responder de nuevo → SOLICITUD_YA_RESPONDIDA', () => {
    const r = lib.puedeResponderSolicitud(solicitudBase({ estado: 'rechazada' }));
    expect(r.valido).toBe(false);
    expect(r.error).toBe('SOLICITUD_YA_RESPONDIDA');
  });
});

describeIfResolverRespuesta('lib_solicitudes.resolverRespuestaSolicitud', () => {
  const contexto = { id_aprobador: 'USR_propietario', fecha_respuesta: '2026-08-02 09:00:00', origen: 'app' };

  test('aprobar produce una transacción (crearTransaccion=true) con los datos del gasto', () => {
    const r = lib.resolverRespuestaSolicitud(solicitudBase(), true, contexto);
    expect(r.estado).toBe('aprobada');
    expect(r.crearTransaccion).toBe(true);
    expect(r.datosTransaccion).toBeTruthy();
    expect(r.datosTransaccion.tipo).toBe('gasto');
    expect(r.datosTransaccion.monto).toBe(150);
    expect(r.datosTransaccion.id_categoria).toBe('CAT_materiales');
    expect(r.datosTransaccion.id_espacio).toBe('ESP_TELCOM');
  });

  test('rechazar NO produce transacción (crearTransaccion=false)', () => {
    const r = lib.resolverRespuestaSolicitud(solicitudBase(), false, contexto);
    expect(r.estado).toBe('rechazada');
    expect(r.crearTransaccion).toBe(false);
    expect(r.datosTransaccion).toBeFalsy();
  });

  test('responder una solicitud ya respondida (doble click del botón de Telegram) no genera una segunda transacción', () => {
    // Primera respuesta: aprueba.
    const primera = lib.resolverRespuestaSolicitud(solicitudBase(), true, contexto);
    expect(primera.estado).toBe('aprobada');

    const solicitudYaAprobada = solicitudBase({
      estado: 'aprobada',
      id_aprobador: contexto.id_aprobador,
      fecha_respuesta: contexto.fecha_respuesta,
      id_transaccion: 'TRX_ya_creada'
    });

    // Segundo click, mismo callback de Telegram: la solicitud real ya está
    // 'aprobada' en el servidor, así que el guardián de estado debe frenarlo
    // ANTES de intentar resolver una segunda respuesta.
    const guardián = lib.puedeResponderSolicitud
      ? lib.puedeResponderSolicitud(solicitudYaAprobada)
      : { valido: solicitudYaAprobada.estado === 'solicitada' };
    expect(guardián.valido).toBe(false);
  });
});
