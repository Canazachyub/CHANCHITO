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
      usuario: usuarioPublico(usuario),
      token_sesion: tokenSesion,
      expira: Utilities.formatDate(expira, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    });
  });
}

// ==================== LOGIN CON USUARIO Y CONTRASEÑA (§ 0.1-bis) ====================

var _MAX_INTENTOS = 5;
var _TTL_BLOQUEO_SEGUNDOS = 15 * 60;

function _sha256Hex(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Sal nueva por usuario. Utilities.getUuid() es aleatorio criptográfico (v4). */
function _nuevaSal() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function nuevaPasswordTemporal() {
  return generarPasswordTemporal((Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
}

/** Campos a escribir para fijar una contraseña. `temporal` obliga a cambiarla al entrar. */
function camposPassword(password, temporal) {
  var sal = _nuevaSal();
  return {
    password_salt: sal,
    password_iter: PASSWORD_ITERACIONES,
    password_hash: derivarHashPassword(password, sal, PASSWORD_ITERACIONES, _sha256Hex),
    debe_cambiar_password: !!temporal,
    password_actualizado: fechaHoraActual()
  };
}

function _crearSesion(sheet, fila) {
  var ahora = fechaHoraActual();
  var colUltimaSesion = fila.headers.indexOf('ultima_sesion');
  if (colUltimaSesion >= 0) sheet.getRange(fila.row, colUltimaSesion + 1).setValue(ahora);
  var usuario = fila.datos;
  usuario.ultima_sesion = ahora;

  var tokenSesion = Utilities.getUuid();
  CacheService.getScriptCache().put(_PREFIJO_CACHE_SESION + tokenSesion, usuario.id_usuario, _TTL_SESION_SEGUNDOS);
  var expira = new Date(Date.now() + _TTL_SESION_SEGUNDOS * 1000);
  return respuestaExito({
    usuario: usuarioPublico(usuario),
    token_sesion: tokenSesion,
    expira: Utilities.formatDate(expira, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  });
}

/**
 * loginPassword({ usuario, password }). Errores deliberadamente genéricos
 * (CREDENCIALES_INVALIDAS) para no revelar si el usuario existe. Tras 5 intentos
 * fallidos se bloquea ese usuario 15 minutos (CacheService).
 */
function loginPassword(datos) {
  var nombreUsuario = normalizarUsuario(datos && datos.usuario);
  var password = datos && datos.password;
  if (!nombreUsuario || !password) return respuestaError('CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos.');

  var cache = CacheService.getScriptCache();
  var claveIntentos = 'intentos_' + nombreUsuario;
  var intentos = parseInt(cache.get(claveIntentos), 10) || 0;
  if (intentos >= _MAX_INTENTOS) {
    return respuestaError('CUENTA_BLOQUEADA', 'Demasiados intentos fallidos. Espera 15 minutos o pide al administrador que restablezca tu contraseña.');
  }

  var sheet = getSheet(SHEETS.USUARIOS);
  var usuario = getAllData(sheet).filter(function (u) {
    return String(u.usuario || '').toLowerCase() === nombreUsuario && u.activo === true;
  })[0];

  // Con usuario inexistente igual se calcula un hash: así la respuesta tarda lo mismo y el
  // tiempo no delata qué usuarios existen.
  var sal = usuario && usuario.password_salt ? usuario.password_salt : 'sal-inexistente';
  var hash = derivarHashPassword(String(password), sal, usuario ? usuario.password_iter : PASSWORD_ITERACIONES, _sha256Hex);
  var correcto = !!(usuario && usuario.password_hash) && compararSeguro(hash, usuario.password_hash);

  if (!correcto) {
    cache.put(claveIntentos, String(intentos + 1), _TTL_BLOQUEO_SEGUNDOS);
    return respuestaError('CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos.');
  }
  cache.remove(claveIntentos);

  return withLock(function () {
    return _crearSesion(sheet, buscarPorId(sheet, 'id_usuario', usuario.id_usuario));
  });
}

/** cambiarPassword({ actual, nueva }, usuarioSesion). Exige la actual aunque sea temporal. */
function cambiarPassword(datos, usuarioSesion) {
  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', usuarioSesion.id_usuario);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Usuario no encontrado.');
  var u = fila.datos;

  if (u.password_hash) {
    var hashActual = derivarHashPassword(String(datos.actual || ''), u.password_salt, u.password_iter, _sha256Hex);
    if (!compararSeguro(hashActual, u.password_hash)) return respuestaError('CREDENCIALES_INVALIDAS', 'La contraseña actual no es correcta.');
  }
  if (String(datos.nueva || '') === String(datos.actual || '')) {
    return respuestaError('PASSWORD_DEBIL', 'La nueva contraseña tiene que ser distinta de la actual.');
  }
  var v = validarPasswordNueva(datos.nueva, { usuario: u.usuario, nombre: u.nombre });
  if (!v.valido) return respuestaError(v.error, v.detalle);

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, camposPassword(String(datos.nueva), false), ['id_usuario']);
    return respuestaExito({ usuario: usuarioPublico(buscarPorId(sheet, 'id_usuario', u.id_usuario).datos) });
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
