/**
 * 23_solicitudes.js — Solicitudes de dinero (docs/CONTRACT.md § 4-bis).
 *
 * Alguien en campo pide plata para un trámite o materiales; hoy eso se resuelve
 * por WhatsApp sin quedar registrado. Flujo corto: cualquier miembro crea una
 * solicitud (`solicitada`); el propietario la aprueba (crea el gasto de una
 * vez) o la rechaza. Crítico: una solicitud respondida no se puede volver a
 * responder (SOLICITUD_YA_RESPONDIDA) — sin esa guardia, dos toques al botón
 * de Telegram crean dos gastos.
 *
 * No es entidad sincronizable: sin rev, no entra en `sincronizar` (§ 2).
 *
 * Prefijo `sol` en todo lo interno para no chocar con otros dominios del
 * scope global único de Apps Script.
 *
 * Dependencias externas verificadas contra el código real ya presente en
 * /backend (no contra la memoria):
 *   - 00_config.js: SHEETS, ESQUEMA_COLUMNAS, getProp.
 *   - 02_util.js: getSheet, getAllData, buscarPorId, escribirCampos,
 *     generateId, fechaHoraActual, withLock, respuestaExito, respuestaError,
 *     reportarSentry.
 *   - lib_validacion.js: validarMonto, validarRequeridos, validarTipo, sanearTexto.
 *   - 14_transacciones.js: crearTransaccionInterna(datosNormalizados, idForzado)
 *     — variante SIN lock propio, pensada para llamarse desde dentro de OTRO
 *     withLock() (la usan 19_recurrentes.js y 30_sincronizar.js del mismo
 *     modo). Se usa acá en vez de crearTransaccion() (que sí lockea
 *     internamente) para no anidar locks — LockService.getScriptLock() es el
 *     mismo lock por ejecución, y el release() de una llamada anidada
 *     liberaría el lock antes de que termine el resto de esta función.
 *   - 21_notificaciones.js: crearNotificacionInterna(datos) — NO lockea
 *     internamente (solo appendRow), seguro de llamar tanto dentro como fuera
 *     de un withLock().
 *   - 40_telegram.js: tgEnviarMensaje(chatId, texto, teclado), tgFormatoMonto(valor).
 *   - 42_telegram_teclados.js: tgTecladoSolicitud(idSolicitud).
 *
 * Wiring de los botones de Telegram: el teclado de aprobar/rechazar lo arma
 * `tgTecladoSolicitud` (42_telegram_teclados.js) y este archivo NO lo duplica.
 * Sus prefijos de callback_data (`sap:` / `srj:`) tienen que ser exactamente los
 * que rutea `tgManejarCallbackQuery` (40_telegram.js). Cuando el teclado estuvo
 * definido en los dos lados, los prefijos divergieron y los botones no hacían
 * nada: un solo dueño del formato evita que vuelva a pasar.
 */

var _ORIGENES_VALIDOS_SOLICITUD = ['app', 'bot_texto'];

// ==================== HELPERS INTERNOS ====================

function sol_buscarPropietario() {
  var usuarios = getAllData(getSheet(SHEETS.USUARIOS));
  for (var i = 0; i < usuarios.length; i++) {
    if (usuarios[i].rol_global === 'propietario' && usuarios[i].activo) return usuarios[i];
  }
  return null;
}

/** Cuenta activa de menor `orden` del espacio — mismo criterio que usa el bot (40_telegram.js) para el registro por foto/texto. */
function sol_cuentaPorDefecto(idEspacio) {
  var cuentas = getAllData(getSheet(SHEETS.CUENTAS)).filter(function (c) {
    return c.id_espacio === idEspacio && c.activo;
  });
  if (!cuentas.length) return null;
  cuentas.sort(function (a, b) { return (parseFloat(a.orden) || 0) - (parseFloat(b.orden) || 0); });
  return cuentas[0];
}

function sol_crearFila(datos) {
  var sheet = getSheet(SHEETS.SOLICITUDES_DINERO);
  var id = generateId('SOL');
  var ahora = fechaHoraActual();

  var obj = {
    id_solicitud: id,
    id_espacio: datos.id_espacio,
    id_solicitante: datos.id_solicitante,
    monto: datos.monto,
    motivo: datos.motivo,
    id_categoria: datos.id_categoria,
    estado: 'solicitada',
    id_aprobador: '',
    fecha_solicitud: ahora,
    fecha_respuesta: '',
    id_transaccion: '',
    notas: '',
    eliminado: false,
    fecha_modificacion: ahora
  };

  anexarFila(sheet, obj);

  return obj;
}

/** Notificación interna + Telegram al propietario con los botones de aprobar/rechazar. Nunca lanza: mejor una solicitud sin avisar que perder la escritura ya confirmada. */
function sol_notificarPropietarioNuevaSolicitud(solicitud, solicitanteUsuario) {
  var propietario = sol_buscarPropietario();
  if (!propietario) return;

  var filaCategoria = buscarPorId(getSheet(SHEETS.CATEGORIAS), 'id_categoria', solicitud.id_categoria);
  var categoriaNombre = filaCategoria ? filaCategoria.datos.nombre : null;

  var resumen = solicitanteUsuario.nombre + ' pidió ' + tgFormatoMonto(solicitud.monto) + ' — ' + solicitud.motivo;

  crearNotificacionInterna({
    id_usuario: propietario.id_usuario,
    tipo: 'solicitud',
    titulo: 'Nueva solicitud de dinero',
    mensaje: resumen,
    datos: { id_solicitud: solicitud.id_solicitud },
    canal: propietario.telegram_chat_id ? 'telegram' : 'app'
  });

  if (!propietario.telegram_chat_id) return;

  var lineas = [
    '💸 Nueva solicitud de dinero',
    'De: ' + solicitanteUsuario.nombre,
    'Monto: ' + tgFormatoMonto(solicitud.monto),
    'Motivo: ' + solicitud.motivo
  ];
  if (categoriaNombre) lineas.push('Categoría: ' + categoriaNombre);

  // El teclado lo arma 42_telegram_teclados.js y NO se duplica acá: el prefijo de
  // callback_data tiene que ser exactamente el que rutea tgManejarCallbackQuery
  // (40_telegram.js). Cuando estaban definidos en los dos lados, divergieron
  // ('solap:' acá contra 'sap:' allá) y los botones no hacían nada.
  var teclado = tgTecladoSolicitud(solicitud.id_solicitud);

  tgEnviarMensaje(propietario.telegram_chat_id, lineas.join('\n'), teclado);
}

/** Avisa al solicitante la respuesta: Telegram si tiene chat_id, si no solo notificación interna. Nunca lanza. */
function sol_avisarSolicitante(solicitud, aprobada) {
  var filaUsuario = buscarPorId(getSheet(SHEETS.USUARIOS), 'id_usuario', solicitud.id_solicitante);
  var solicitante = filaUsuario ? filaUsuario.datos : null;
  if (!solicitante) return;

  var texto = aprobada
    ? ('✅ Tu solicitud de ' + tgFormatoMonto(solicitud.monto) + ' fue aprobada.')
    : ('❌ Tu solicitud de ' + tgFormatoMonto(solicitud.monto) + ' fue rechazada.' + (solicitud.notas ? (' Motivo: ' + solicitud.notas) : ''));

  crearNotificacionInterna({
    id_usuario: solicitante.id_usuario,
    tipo: 'solicitud',
    titulo: aprobada ? 'Solicitud aprobada' : 'Solicitud rechazada',
    mensaje: texto,
    datos: { id_solicitud: solicitud.id_solicitud },
    canal: solicitante.telegram_chat_id ? 'telegram' : 'app'
  });

  if (solicitante.telegram_chat_id) {
    tgEnviarMensaje(solicitante.telegram_chat_id, texto);
  }
}

// ==================== ENDPOINTS (nombres exactos — docs/CONTRACT.md § 3) ====================

/**
 * crearSolicitud(p, u) — cualquier miembro activo. `u` es el usuario de la
 * sesión (el solicitante); su id_usuario se usa siempre como id_solicitante,
 * nunca lo que venga en `p` (evita que alguien solicite en nombre de otro).
 */
function crearSolicitud(p, u) {
  var datos = p || {};
  if (!u || !u.id_usuario) return respuestaError('SESION_INVALIDA', 'Falta el usuario de la sesión.');

  var req = validarRequeridos(datos, ['id_espacio', 'monto', 'motivo', 'id_categoria']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var montoV = validarMonto(datos.monto);
  if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);

  var solicitudCreada = null;

  var resultadoLock = withLock(function () {
    solicitudCreada = sol_crearFila({
      id_espacio: datos.id_espacio,
      id_solicitante: u.id_usuario,
      monto: montoV.valor,
      motivo: sanearTexto(datos.motivo, 500),
      id_categoria: datos.id_categoria
    });
    return respuestaExito({ id_solicitud: solicitudCreada.id_solicitud, solicitud: solicitudCreada });
  });

  if (!resultadoLock || resultadoLock.success === false) return resultadoLock;

  try {
    sol_notificarPropietarioNuevaSolicitud(solicitudCreada, u);
  } catch (err) {
    reportarSentry(err, { origen: 'crearSolicitud:notificar', id_solicitud: solicitudCreada.id_solicitud });
  }

  return resultadoLock;
}

/**
 * getSolicitudes(p) — filtrable por p.id_espacio y p.estado (ambos opcionales).
 * TODO(contrato): el contrato no especifica una validación explícita de
 * membresía por espacio para esta lectura (a diferencia de otras acciones de
 * dominio, no recibe `u`); se deja el filtrado simple por id_espacio y se
 * reporta acá para que el agente de router/espacios lo revise si hace falta
 * un NO_ES_MIEMBRO más estricto.
 */
function getSolicitudes(p) {
  var datos = p || {};
  var sheet = getSheet(SHEETS.SOLICITUDES_DINERO);
  var solicitudes = getAllData(sheet).filter(function (s) { return !s.eliminado; });

  if (datos.id_espacio) solicitudes = solicitudes.filter(function (s) { return s.id_espacio === datos.id_espacio; });
  if (datos.estado) solicitudes = solicitudes.filter(function (s) { return s.estado === datos.estado; });

  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var usuarios = getAllData(getSheet(SHEETS.USUARIOS));

  solicitudes = solicitudes.map(function (s) {
    var categoria = categorias.filter(function (c) { return c.id_categoria === s.id_categoria; })[0];
    var solicitante = usuarios.filter(function (us) { return us.id_usuario === s.id_solicitante; })[0];
    var enriquecida = {};
    for (var k in s) enriquecida[k] = s[k];
    enriquecida.categoria_nombre = categoria ? categoria.nombre : null;
    enriquecida.categoria_icono = categoria ? categoria.icono : null;
    enriquecida.solicitante_nombre = solicitante ? solicitante.nombre : null;
    return enriquecida;
  });

  solicitudes.sort(function (a, b) {
    if (a.fecha_solicitud === b.fecha_solicitud) return 0;
    return a.fecha_solicitud < b.fecha_solicitud ? 1 : -1;
  });

  return respuestaExito({ solicitudes: solicitudes });
}

/**
 * responderSolicitud(p, u) — SOLO propietario. `p.id_solicitud` requerido,
 * `p.aprobar` boolean, `p.motivo`/`p.notas` opcional (motivo de rechazo).
 * `p.origen` opcional ('app' | 'bot_texto') para la transacción que se crea
 * al aprobar — por defecto 'app'.
 *
 * La verificación de `estado !== 'solicitada'` y la escritura del nuevo
 * estado ocurren dentro del MISMO withLock(): es la guardia real contra la
 * condición de carrera de doble aprobación (dos toques casi simultáneos al
 * botón de Telegram). Verificar afuera del lock y escribir adentro deja una
 * ventana entre lectura y escritura donde ambos toques pasan la verificación.
 */
function responderSolicitud(p, u) {
  var datos = p || {};
  if (!u || !u.id_usuario) return respuestaError('SESION_INVALIDA', 'Falta el usuario de la sesión.');
  if (u.rol_global !== 'propietario') {
    return respuestaError('SIN_PERMISO', 'Solo el propietario puede responder solicitudes de dinero.');
  }

  var req = validarRequeridos(datos, ['id_solicitud']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var aprobar = datos.aprobar === true || datos.aprobar === 'true';

  var origenTransaccion = 'app';
  if (datos.origen !== undefined && datos.origen !== '') {
    var origenV = validarTipo(datos.origen, _ORIGENES_VALIDOS_SOLICITUD);
    if (!origenV.valido) return respuestaError(origenV.error, 'El origen debe ser "app" o "bot_texto".');
    origenTransaccion = origenV.valor;
  }

  var sheet = getSheet(SHEETS.SOLICITUDES_DINERO);
  var solicitudActualizada = null;

  var resultadoLock = withLock(function () {
    var fila = buscarPorId(sheet, 'id_solicitud', datos.id_solicitud);
    if (!fila) {
      return respuestaError('NO_ENCONTRADO', 'Solicitud no encontrada.');
    }

    // Guardia crítica contra doble aprobación — ver docblock de la función.
    // La decisión vive en lib_solicitudes.js (pura, cubierta por tests); acá solo se
    // aplica, y adentro del lock, que es lo que la vuelve efectiva contra el doble toque.
    var guarda = puedeResponderSolicitud(fila.datos);
    if (!guarda.valido) {
      return respuestaError(guarda.error, guarda.detalle);
    }

    var ahora = fechaHoraActual();
    var paraEscribir = {
      id_aprobador: u.id_usuario,
      fecha_respuesta: ahora,
      fecha_modificacion: ahora
    };

    if (aprobar) {
      var cuenta = sol_cuentaPorDefecto(fila.datos.id_espacio);
      if (!cuenta) {
        return respuestaError('NO_ENCONTRADO', 'No hay ninguna cuenta activa configurada en ese espacio.');
      }

      var montoV = validarMonto(fila.datos.monto);
      if (!montoV.valido) {
        return respuestaError('MONTO_INVALIDO', 'El monto de la solicitud quedó corrupto y no se puede aprobar.');
      }

      // crearTransaccionInterna: variante SIN lock propio — ya estamos
      // dentro de este withLock(), así que anidar crearTransaccion() (que sí
      // lockea) liberaría el lock antes de tiempo. Ver dependencias arriba.
      var transaccionCreada = crearTransaccionInterna({
        id_espacio: fila.datos.id_espacio,
        id_usuario: fila.datos.id_solicitante,
        id_cuenta: cuenta.id_cuenta,
        id_categoria: fila.datos.id_categoria,
        tipo: 'gasto',
        monto: montoV.valor,
        descripcion: fila.datos.motivo,
        notas: 'Generado desde solicitud de dinero ' + fila.datos.id_solicitud,
        origen: origenTransaccion
      }, null);

      paraEscribir.estado = 'aprobada';
      paraEscribir.id_transaccion = transaccionCreada.id_transaccion;
    } else {
      paraEscribir.estado = 'rechazada';
      paraEscribir.notas = sanearTexto(datos.motivo || datos.notas || '', 500);
    }

    escribirCampos(sheet, fila.row, fila.headers, paraEscribir, ['id_solicitud']);
    solicitudActualizada = buscarPorId(sheet, 'id_solicitud', datos.id_solicitud).datos;

    return respuestaExito({ solicitud: solicitudActualizada });
  });

  if (!resultadoLock || resultadoLock.success === false) return resultadoLock;

  try {
    sol_avisarSolicitante(solicitudActualizada, aprobar);
  } catch (err) {
    reportarSentry(err, { origen: 'responderSolicitud:avisar', id_solicitud: datos.id_solicitud });
  }

  return resultadoLock;
}
