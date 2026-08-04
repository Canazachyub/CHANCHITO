/**
 * 01_router.js — doGet / doPost, autenticación de token y ruteo de acciones.
 * `action` siempre viaja como parámetro de URL (docs/CONTRACT.md § 3).
 *
 * Guardia de espacio (docs/CONTRACT.md § 0.3 y § 3): toda acción de dominio
 * que opere sobre un espacio compartido declara `idEspacio: function(params)`,
 * que devuelve el `id_espacio` objetivo — tomado directo del request cuando la
 * acción lo recibe así (listados, creaciones), o resuelto desde el registro
 * que la acción toca cuando el request solo trae el id de ese registro
 * (ediciones, bajas, lecturas puntuales). Si el resolver no puede determinar
 * un id_espacio (p.ej. el registro no existe) se omite la guardia y se deja
 * que la función de dominio devuelva NO_ENCONTRADO: no hay nada que proteger
 * de un registro que no existe. Si sí lo determina, `requiereMiembro`
 * (03_auth.js) valida que el espacio exista y que el usuario de la sesión sea
 * miembro activo — nunca se llega a leer o escribir data de un espacio ajeno.
 */

/** Resuelve el id_espacio de una SolicitudDinero a partir de su id (23_solicitudes.js, otro agente). */
function _idEspacioDeSolicitud(idSolicitud) {
  var fila = buscarPorId(getSheet(SHEETS.SOLICITUDES_DINERO), 'id_solicitud', idSolicitud);
  return fila ? fila.datos.id_espacio : null;
}

/** Resuelve el id_espacio de una ObligacionMensual a partir de su id (24_obligaciones.js, otro agente). */
function _idEspacioDeObligacion(idObligacion) {
  var fila = buscarPorId(getSheet(SHEETS.OBLIGACIONES_MENSUALES), 'id_obligacion', idObligacion);
  return fila ? fila.datos.id_espacio : null;
}

// ==================== TABLA DE ACCIONES GET ====================

var ACCIONES_GET = {
  getUsuario: { auth: 'sesion', fn: function (p) { return getUsuario(p.id_usuario); } },
  getUsuarios: { auth: 'sesion', fn: function () { return getUsuarios(); } },

  getEspacio: { auth: 'sesion', fn: function (p) { return getEspacio(p.id_espacio); }, idEspacio: function (p) { return p.id_espacio; } },
  getEspacios: { auth: 'sesion', fn: function (p, u) { return getEspacios(u); } },
  getMiembros: { auth: 'sesion', fn: function (p) { return getMiembros(p.id_espacio); }, idEspacio: function (p) { return p.id_espacio; } },

  getCuentas: { auth: 'sesion', fn: function (p) { return getCuentas(p.id_espacio); }, idEspacio: function (p) { return p.id_espacio; } },
  getCuenta: { auth: 'sesion', fn: function (p) { return getCuenta(p.id_cuenta); }, idEspacio: function (p) { return idEspacioDeCuenta(p.id_cuenta); } },
  getBalanceCuenta: { auth: 'sesion', fn: function (p) { return getBalanceCuenta(p.id_cuenta); }, idEspacio: function (p) { return idEspacioDeCuenta(p.id_cuenta); } },

  getCategorias: { auth: 'sesion', fn: function (p) { return getCategorias(p.id_espacio, p.tipo, p.grupo); }, idEspacio: function (p) { return p.id_espacio; } },

  getTransacciones: {
    auth: 'sesion',
    fn: function (p) { return getTransacciones(p.id_espacio, p.fecha_inicio, p.fecha_fin, p.tipo, p.id_categoria, p.id_cuenta); },
    idEspacio: function (p) { return p.id_espacio; }
  },
  getTransaccion: { auth: 'sesion', fn: function (p) { return getTransaccion(p.id_transaccion); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },
  getEvidencias: { auth: 'sesion', fn: function (p) { return getEvidencias(p.id_transaccion); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },

  getDeudas: { auth: 'sesion', fn: function (p) { return getDeudas(p.id_espacio, p.tipo, p.estado); }, idEspacio: function (p) { return p.id_espacio; } },
  getDeuda: { auth: 'sesion', fn: function (p) { return getDeuda(p.id_deuda); }, idEspacio: function (p) { return idEspacioDeDeuda(p.id_deuda); } },
  getPagosDeuda: { auth: 'sesion', fn: function (p) { return getPagosDeuda(p.id_deuda); }, idEspacio: function (p) { return idEspacioDeDeuda(p.id_deuda); } },

  getTransferencias: { auth: 'sesion', fn: function (p) { return getTransferencias(p.id_espacio, p.fecha_inicio, p.fecha_fin); }, idEspacio: function (p) { return p.id_espacio; } },

  getPresupuestos: { auth: 'sesion', fn: function (p) { return getPresupuestos(p.id_espacio, p.mes, p.anio); }, idEspacio: function (p) { return p.id_espacio; } },
  getProgresoPresupuesto: { auth: 'sesion', fn: function (p) { return getProgresoPresupuesto(p.id_presupuesto); }, idEspacio: function (p) { return idEspacioDePresupuesto(p.id_presupuesto); } },

  getGastosRecurrentes: { auth: 'sesion', fn: function (p) { return getGastosRecurrentes(p.id_espacio); }, idEspacio: function (p) { return p.id_espacio; } },

  getEtiquetas: { auth: 'sesion', fn: function (p) { return getEtiquetas(p.id_espacio); }, idEspacio: function (p) { return p.id_espacio; } },

  getNotificaciones: { auth: 'sesion', fn: function (p) { return getNotificaciones(p.id_usuario, p.leida); } },

  getDashboard: { auth: 'sesion', fn: function (p) { return getDashboard(p.id_espacio, p.mes, p.anio); }, idEspacio: function (p) { return p.id_espacio; } },
  getResumenMensual: { auth: 'sesion', fn: function (p) { return getResumenMensual(p.id_espacio, p.mes, p.anio); }, idEspacio: function (p) { return p.id_espacio; } },
  getTendencia: { auth: 'sesion', fn: function (p) { return getTendencia(p.id_espacio, p.meses); }, idEspacio: function (p) { return p.id_espacio; } },
  getTopCategorias: { auth: 'sesion', fn: function (p) { return getTopCategorias(p.id_espacio, p.mes, p.anio, p.limite); }, idEspacio: function (p) { return p.id_espacio; } },

  // Implementadas por backend/23_solicitudes.js y backend/24_obligaciones.js (otro agente,
  // en paralelo). El router solo delega — nombres y firmas exactos: docs/CONTRACT.md § 3.
  getSolicitudes: { auth: 'sesion', fn: function (p) { return getSolicitudes(p); }, idEspacio: function (p) { return p.id_espacio || null; } },
  getObligaciones: { auth: 'sesion', fn: function (p) { return getObligaciones(p); }, idEspacio: function (p) { return p.id_espacio || null; } }
};

// ==================== TABLA DE ACCIONES POST ====================
// telegramWebhook NO está aquí: es la única acción que se delega antes de
// validar el token compartido, porque la llama Telegram y valida su propio
// secreto de header (ver _manejarRequest y docs/CONTRACT.md § 3).

var ACCIONES_POST = {
  login: { auth: 'ninguna', fn: function (p) { return login(p); } },

  // Reescribe y consolida toda la data histórica: token compartido + sesión de
  // propietario, como cualquier otra escritura destructiva.
  ejecutarMigracion: { auth: 'propietario', fn: function (p) { return migrarDatos(p); } },

  crearUsuario: { auth: 'propietario', fn: function (p) { return crearUsuario(p); } },
  actualizarUsuario: { auth: 'sesion', fn: function (p, u) { return actualizarUsuario(p, u); } },
  desactivarUsuario: { auth: 'propietario', fn: function (p) { return desactivarUsuario(p); } },

  actualizarEspacio: { auth: 'propietario', fn: function (p) { return actualizarEspacio(p); }, idEspacio: function (p) { return p.id_espacio; } },

  crearCuenta: { auth: 'sesion', fn: function (p) { return crearCuenta(p); }, idEspacio: function (p) { return p.id_espacio; } },
  actualizarCuenta: { auth: 'sesion', fn: function (p) { return actualizarCuenta(p); }, idEspacio: function (p) { return idEspacioDeCuenta(p.id_cuenta); } },
  eliminarCuenta: { auth: 'sesion', fn: function (p) { return eliminarCuenta(p.id_cuenta); }, idEspacio: function (p) { return idEspacioDeCuenta(p.id_cuenta); } },

  crearCategoria: { auth: 'sesion', fn: function (p) { return crearCategoria(p); }, idEspacio: function (p) { return p.id_espacio; } },
  actualizarCategoria: { auth: 'sesion', fn: function (p) { return actualizarCategoria(p); }, idEspacio: function (p) { return idEspacioDeCategoria(p.id_categoria); } },
  eliminarCategoria: { auth: 'sesion', fn: function (p) { return eliminarCategoria(p.id_categoria); }, idEspacio: function (p) { return idEspacioDeCategoria(p.id_categoria); } },

  crearTransaccion: {
    auth: 'sesion',
    fn: function (p, u) { if (!p.id_usuario && u) p.id_usuario = u.id_usuario; return crearTransaccion(p); },
    idEspacio: function (p) { return p.id_espacio; }
  },
  actualizarTransaccion: { auth: 'sesion', fn: function (p) { return actualizarTransaccion(p); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },
  eliminarTransaccion: { auth: 'sesion', fn: function (p) { return eliminarTransaccion(p.id_transaccion); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },

  subirEvidencia: { auth: 'sesion', fn: function (p) { return subirEvidencia(p); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },
  eliminarEvidencia: { auth: 'sesion', fn: function (p) { return eliminarEvidencia(p.id_evidencia); }, idEspacio: function (p) { return idEspacioDeEvidencia(p.id_evidencia); } },

  crearDeuda: {
    auth: 'sesion',
    fn: function (p, u) { if (!p.id_usuario && u) p.id_usuario = u.id_usuario; return crearDeuda(p); },
    idEspacio: function (p) { return p.id_espacio; }
  },
  actualizarDeuda: { auth: 'sesion', fn: function (p) { return actualizarDeuda(p); }, idEspacio: function (p) { return idEspacioDeDeuda(p.id_deuda); } },
  eliminarDeuda: { auth: 'sesion', fn: function (p) { return eliminarDeuda(p.id_deuda); }, idEspacio: function (p) { return idEspacioDeDeuda(p.id_deuda); } },
  registrarPagoDeuda: { auth: 'sesion', fn: function (p) { return registrarPagoDeuda(p); }, idEspacio: function (p) { return idEspacioDeDeuda(p.id_deuda); } },

  realizarTransferencia: {
    auth: 'sesion',
    fn: function (p, u) { if (!p.id_usuario && u) p.id_usuario = u.id_usuario; return realizarTransferencia(p); },
    idEspacio: function (p) { return p.id_espacio; }
  },

  crearPresupuesto: { auth: 'sesion', fn: function (p) { return crearPresupuesto(p); }, idEspacio: function (p) { return p.id_espacio; } },
  actualizarPresupuesto: { auth: 'sesion', fn: function (p) { return actualizarPresupuesto(p); }, idEspacio: function (p) { return idEspacioDePresupuesto(p.id_presupuesto); } },
  eliminarPresupuesto: { auth: 'sesion', fn: function (p) { return eliminarPresupuesto(p.id_presupuesto); }, idEspacio: function (p) { return idEspacioDePresupuesto(p.id_presupuesto); } },

  crearGastoRecurrente: { auth: 'sesion', fn: function (p) { return crearGastoRecurrente(p); }, idEspacio: function (p) { return p.id_espacio; } },
  actualizarGastoRecurrente: { auth: 'sesion', fn: function (p) { return actualizarGastoRecurrente(p); }, idEspacio: function (p) { return idEspacioDeGastoRecurrente(p.id_gasto_recurrente); } },
  eliminarGastoRecurrente: { auth: 'sesion', fn: function (p) { return eliminarGastoRecurrente(p.id_gasto_recurrente); }, idEspacio: function (p) { return idEspacioDeGastoRecurrente(p.id_gasto_recurrente); } },
  ejecutarGastoRecurrente: { auth: 'sesion', fn: function (p) { return ejecutarGastoRecurrente(p.id_gasto_recurrente); }, idEspacio: function (p) { return idEspacioDeGastoRecurrente(p.id_gasto_recurrente); } },

  crearEtiqueta: { auth: 'sesion', fn: function (p) { return crearEtiqueta(p); }, idEspacio: function (p) { return p.id_espacio; } },
  eliminarEtiqueta: { auth: 'sesion', fn: function (p) { return eliminarEtiqueta(p.id_etiqueta); }, idEspacio: function (p) { return idEspacioDeEtiqueta(p.id_etiqueta); } },
  asignarEtiqueta: { auth: 'sesion', fn: function (p) { return asignarEtiqueta(p.id_transaccion, p.id_etiqueta); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },
  removerEtiqueta: { auth: 'sesion', fn: function (p) { return removerEtiqueta(p.id_transaccion, p.id_etiqueta); }, idEspacio: function (p) { return idEspacioDeTransaccion(p.id_transaccion); } },

  marcarNotificacionLeida: { auth: 'sesion', fn: function (p) { return marcarNotificacionLeida(p.id_notificacion); } },
  marcarTodasLeidas: { auth: 'sesion', fn: function (p, u) { return marcarTodasLeidas(p.id_usuario || (u && u.id_usuario)); } },

  sincronizar: { auth: 'sesion', fn: function (p) { return sincronizar(p); }, idEspacio: function (p) { return p.id_espacio; } },

  logError: { auth: 'ninguna', fn: function (p) { return logError(p); } },

  // Implementadas por backend/23_solicitudes.js y backend/24_obligaciones.js (otro agente,
  // en paralelo). El router solo delega — nombres y firmas exactos: docs/CONTRACT.md § 3 y § 4-bis/4-ter.
  crearSolicitud: { auth: 'sesion', fn: function (p, u) { return crearSolicitud(p, u); }, idEspacio: function (p) { return p.id_espacio; } },
  responderSolicitud: { auth: 'propietario', fn: function (p, u) { return responderSolicitud(p, u); }, idEspacio: function (p) { return _idEspacioDeSolicitud(p.id_solicitud); } },

  crearObligacion: { auth: 'propietario', fn: function (p) { return crearObligacion(p); }, idEspacio: function (p) { return p.id_espacio; } },
  actualizarObligacion: { auth: 'propietario', fn: function (p) { return actualizarObligacion(p); }, idEspacio: function (p) { return _idEspacioDeObligacion(p.id_obligacion); } },
  eliminarObligacion: { auth: 'propietario', fn: function (p) { return eliminarObligacion(p.id_obligacion); }, idEspacio: function (p) { return _idEspacioDeObligacion(p.id_obligacion); } },
  // No restringida a propietario en el contrato (§ 4-ter solo marca las tres de arriba); es
  // idempotente por mes y también la dispara el trigger diario directo, sin pasar por acá.
  generarObligacionesDelMes: { auth: 'sesion', fn: function () { return generarObligacionesDelMes(); } }
};

// ==================== ENTRADA HTTP ====================

function doGet(e) {
  return _manejarRequest(e, 'GET');
}

function doPost(e) {
  return _manejarRequest(e, 'POST');
}

function _manejarRequest(e, metodoHttp) {
  var action = e && e.parameter && e.parameter.action;

  try {
    // Única excepción: la llama Telegram, que no puede mandar nuestro token
    // compartido. Valida su propio secreto de header (docs/CONTRACT.md § 3).
    if (action === 'telegramWebhook') {
      return manejarTelegramWebhook(e);
    }

    var tokenRecibido = e && e.parameter && e.parameter.token;
    if (tokenRecibido !== getProp('SHARED_TOKEN')) {
      return jsonResponse(respuestaError('TOKEN_INVALIDO', 'Token compartido inválido o ausente.'));
    }

    if (!action) {
      return jsonResponse(respuestaError('CAMPO_REQUERIDO', 'falta: action'));
    }

    var tabla = metodoHttp === 'GET' ? ACCIONES_GET : ACCIONES_POST;
    var registro = tabla[action];

    if (!registro) {
      return jsonResponse(respuestaError('NO_ENCONTRADO', 'Acción no reconocida: ' + action));
    }

    var params = metodoHttp === 'GET' ? (e.parameter || {}) : _leerCuerpoPost(e);

    var usuarioSesion = null;
    if (registro.auth === 'sesion') {
      var guardaSesion = requiereSesion(e);
      if (!guardaSesion.ok) return jsonResponse(guardaSesion.respuesta);
      usuarioSesion = guardaSesion.usuario;
    } else if (registro.auth === 'propietario') {
      var guardaPropietario = requierePropietario(e);
      if (!guardaPropietario.ok) return jsonResponse(guardaPropietario.respuesta);
      usuarioSesion = guardaPropietario.usuario;
    }

    // Guardia de espacio (docs/CONTRACT.md § 0.3 y § 3) — ver comentario de
    // cabecera. Se salta solo cuando el resolver no puede determinar un
    // id_espacio (registro inexistente): la función de dominio de abajo
    // devuelve NO_ENCONTRADO por su cuenta.
    if (registro.idEspacio) {
      var idEspacioObjetivo = registro.idEspacio(params);
      if (idEspacioObjetivo) {
        var guardaEspacio = requiereMiembro(idEspacioObjetivo, usuarioSesion);
        if (!guardaEspacio.ok) return jsonResponse(guardaEspacio.respuesta);
      }
    }

    var resultado = registro.fn(params, usuarioSesion);
    return jsonResponse(resultado);

  } catch (error) {
    var mensaje = error && error.message ? error.message : String(error);
    registrarErrorSistema(mensaje, { action: action, metodo: metodoHttp });
    reportarSentry(error, { action: action, metodo: metodoHttp });
    return jsonResponse(respuestaError('ERROR_INTERNO', mensaje));
  }
}

function _leerCuerpoPost(e) {
  var data = {};

  if (e && e.postData && e.postData.contents) {
    try {
      data = JSON.parse(e.postData.contents);
    } catch (error) {
      data = {};
    }
  }

  // Fallback: si el body llegó vacío (algunos clientes pierden el body en
  // redirects de Apps Script), se acepta ?data=<json codificado>.
  if (Object.keys(data).length === 0 && e && e.parameter && e.parameter.data) {
    try {
      data = JSON.parse(decodeURIComponent(e.parameter.data));
    } catch (error) {
      data = {};
    }
  }

  return data;
}
