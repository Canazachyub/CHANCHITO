/**
 * 03_auth.js — Google Sign-In, sesión (CacheService) y guardias de rol.
 */

var _PREFIJO_CACHE_SESION = 'sesion_';
var _TTL_SESION_SEGUNDOS = 6 * 60 * 60; // 6 horas — docs/CONTRACT.md § 3.

/**
 * Valida un id_token de Google contra el endpoint tokeninfo. Devuelve el email
 * si es válido (aud correcto, no expiró, email_verified) o null si no.
 */
function verificarIdToken(idToken) {
  if (!idToken) return null;
  try {
    var resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;

    var info = JSON.parse(resp.getContentText());

    if (info.aud !== getProp('GOOGLE_CLIENT_ID')) return null;

    var exp = parseInt(info.exp, 10);
    if (isNaN(exp) || exp * 1000 < Date.now()) return null;

    if (info.email_verified !== 'true' && info.email_verified !== true) return null;

    return info.email;
  } catch (error) {
    return null;
  }
}

/**
 * login({ id_token }) → { success, data: { usuario, token_sesion, expira } }
 * Alta previa obligatoria: el email debe existir en Usuarios con activo=true.
 */
function login(datos) {
  var idToken = datos && datos.id_token;
  if (!idToken) return respuestaError('CAMPO_REQUERIDO', 'falta: id_token');

  var email = verificarIdToken(idToken);
  if (!email) return respuestaError('SESION_INVALIDA', 'El token de Google no es válido o expiró.');

  var sheet = getSheet(SHEETS.USUARIOS);
  var usuarios = getAllData(sheet);
  var usuario = usuarios.filter(function (u) { return u.email === email && u.activo === true; })[0];

  if (!usuario) {
    return respuestaError('USUARIO_NO_AUTORIZADO', 'Este correo no tiene acceso a Chanchito. Pide al administrador que te dé de alta.');
  }

  return withLock(function () {
    var fila = buscarPorId(sheet, 'id_usuario', usuario.id_usuario);
    var ahora = fechaHoraActual();
    if (fila) {
      var colUltimaSesion = fila.headers.indexOf('ultima_sesion');
      if (colUltimaSesion >= 0) {
        sheet.getRange(fila.row, colUltimaSesion + 1).setValue(ahora);
      }
      usuario = fila.datos;
      usuario.ultima_sesion = ahora;
    }

    var tokenSesion = Utilities.getUuid();
    CacheService.getScriptCache().put(_PREFIJO_CACHE_SESION + tokenSesion, usuario.id_usuario, _TTL_SESION_SEGUNDOS);

    var expira = new Date(Date.now() + _TTL_SESION_SEGUNDOS * 1000);

    return respuestaExito({
      usuario: usuario,
      token_sesion: tokenSesion,
      expira: Utilities.formatDate(expira, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    });
  });
}

function obtenerIdUsuarioDeSesion(tokenSesion) {
  if (!tokenSesion) return null;
  return CacheService.getScriptCache().get(_PREFIJO_CACHE_SESION + tokenSesion);
}

/**
 * Guardia para el router: exige `sesion=<token_sesion>` válido y usuario activo.
 * → { ok: true, usuario } o { ok: false, respuesta: {success:false,...} }
 */
function requiereSesion(e) {
  var tokenSesion = e && e.parameter && e.parameter.sesion;
  var idUsuario = obtenerIdUsuarioDeSesion(tokenSesion);

  if (!idUsuario) {
    return { ok: false, respuesta: respuestaError('SESION_INVALIDA', 'Tu sesión expiró o no existe. Vuelve a iniciar sesión.') };
  }

  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', idUsuario);

  if (!fila || fila.datos.activo !== true) {
    return { ok: false, respuesta: respuestaError('SESION_INVALIDA', 'El usuario de esta sesión ya no está activo.') };
  }

  return { ok: true, usuario: fila.datos };
}

/**
 * Guardia para el router: exige sesión válida y rol_global='propietario'.
 */
function requierePropietario(e) {
  var resultado = requiereSesion(e);
  if (!resultado.ok) return resultado;

  if (resultado.usuario.rol_global !== 'propietario') {
    return { ok: false, respuesta: respuestaError('SIN_PERMISO', 'Esta acción solo puede realizarla el propietario del sistema.') };
  }

  return resultado;
}

/**
 * Guardia de pertenencia a espacio (docs/CONTRACT.md § 0.3 y § 3): toda acción
 * de dominio que reciba `id_espacio` (directo o resuelto desde el registro que
 * toca) debe pasar por acá antes de leer o escribir. Dos espacios compartidos
 * — ESP_FAMILIA y ESP_TELCOM — nunca se mezclan ni se agregan entre sí.
 *
 * → { ok: true } o { ok: false, respuesta: {success:false, error, detalle} }
 */
function requiereMiembro(idEspacio, usuario) {
  if (!idEspacio) {
    return { ok: false, respuesta: respuestaError('ESPACIO_INVALIDO', 'Falta indicar el espacio.') };
  }
  if (!usuario) {
    return { ok: false, respuesta: respuestaError('SESION_INVALIDA', 'Tu sesión expiró o no existe. Vuelve a iniciar sesión.') };
  }

  var espaciosSheet = getSheet(SHEETS.ESPACIOS);
  var filaEspacio = buscarPorId(espaciosSheet, 'id_espacio', idEspacio);
  if (!filaEspacio || filaEspacio.datos.activo !== true) {
    return { ok: false, respuesta: respuestaError('ESPACIO_INVALIDO', 'El espacio indicado no existe.') };
  }

  var miembros = getAllData(getSheet(SHEETS.MIEMBROS_ESPACIO));
  var esMiembro = miembros.some(function (m) {
    return m.id_espacio === idEspacio && m.id_usuario === usuario.id_usuario && m.activo;
  });

  if (!esMiembro) {
    return { ok: false, respuesta: respuestaError('NO_ES_MIEMBRO', 'No eres miembro activo de este espacio.') };
  }

  return { ok: true };
}
