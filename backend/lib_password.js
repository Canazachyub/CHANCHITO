/**
 * lib_password.js — PURO. Contraseñas propias (docs/CONTRACT.md § 0.1-bis).
 *
 * En la hoja nunca se guarda la contraseña: solo un hash con sal propia por usuario y muchas
 * iteraciones. El SHA-256 se inyecta (`sha256Hex`) porque en Apps Script sale de
 * Utilities.computeDigest y en Jest de node:crypto; así el mismo código se prueba y se ejecuta.
 *
 * Por qué iterar: un SHA-256 suelto se prueba por fuerza bruta a miles de millones por segundo.
 * Repetirlo miles de veces hace cada intento miles de veces más caro, para el atacante igual que
 * para nosotros. El número de iteraciones se guarda por usuario para poder subirlo después.
 */

var PASSWORD_ITERACIONES = 5000;
var PASSWORD_MIN = 8;
var USUARIO_REGEX = /^[a-z0-9][a-z0-9._-]{2,29}$/;

// Lo primero que prueba cualquiera. No pretende ser exhaustiva: corta lo obvio.
var PASSWORDS_COMUNES = ['12345678', '123456789', '1234567890', 'password', 'contraseña', 'contrasena',
  'qwerty123', 'chanchito', 'telcom123', 'peru1234', 'abc12345', 'password1', '11111111', '00000000'];

/** 'Darwin.Canaza ' → 'darwin.canaza'. null si no cumple el formato. */
function normalizarUsuario(valor) {
  var u = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
  return USUARIO_REGEX.test(u) ? u : null;
}

/**
 * validarPasswordNueva(pw, contexto) → { valido, error?, detalle? }
 * `contexto` = { usuario, nombre } para no aceptar la propia identidad como contraseña.
 */
function validarPasswordNueva(pw, contexto) {
  var p = String(pw === undefined || pw === null ? '' : pw);
  var falla = function (detalle) { return { valido: false, error: 'PASSWORD_DEBIL', detalle: detalle }; };

  if (p.length < PASSWORD_MIN) return falla('Debe tener al menos ' + PASSWORD_MIN + ' caracteres.');
  if (p.length > 128) return falla('Es demasiado larga (máximo 128).');
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(p) || !/\d/.test(p)) return falla('Debe tener letras y números.');
  if (PASSWORDS_COMUNES.indexOf(p.toLowerCase()) !== -1) return falla('Es demasiado común.');

  var bajo = p.toLowerCase();
  var ctx = contexto || {};
  var partes = [ctx.usuario].concat(String(ctx.nombre || '').split(/\s+/));
  for (var i = 0; i < partes.length; i++) {
    var parte = String(partes[i] || '').toLowerCase();
    if (parte.length >= 4 && bajo.indexOf(parte) !== -1) return falla('No puede contener tu usuario ni tu nombre.');
  }
  return { valido: true };
}

/** hash = SHA256 iterado sobre (hash anterior + sal + contraseña). Determinista. */
function derivarHashPassword(password, sal, iteraciones, sha256Hex) {
  var n = parseInt(iteraciones, 10) || PASSWORD_ITERACIONES;
  var h = sha256Hex(sal + ':' + password);
  for (var i = 1; i < n; i++) h = sha256Hex(h + sal + password);
  return h;
}

/** Comparación en tiempo constante: no revela por el tiempo cuántos caracteres coinciden. */
function compararSeguro(a, b) {
  var x = String(a);
  var y = String(b);
  var dif = x.length ^ y.length;
  var largo = Math.max(x.length, y.length);
  for (var i = 0; i < largo; i++) dif |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return dif === 0;
}

// Sin 0/O, 1/l/I: la contraseña temporal se dicta por teléfono o se copia de un papel.
var _ALFABETO_TEMPORAL = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Contraseña temporal de 12 caracteres a partir de entropía hex (en Apps Script, UUIDs
 * aleatorios). Siempre lleva letras y números para pasar validarPasswordNueva.
 */
function generarPasswordTemporal(entropiaHex) {
  var hex = String(entropiaHex).replace(/[^0-9a-f]/gi, '');
  if (hex.length < 48) throw new Error('generarPasswordTemporal necesita al menos 48 dígitos hex de entropía.');
  var letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  var digitos = '23456789';
  var salida = '';
  for (var i = 0; i < 12; i++) {
    var valor = parseInt(hex.substr(i * 4, 4), 16);
    // Posición 3 siempre número y 7 siempre letra: garantiza la mezcla sin sesgar el resto.
    var alfabeto = i === 3 ? digitos : i === 7 ? letras : _ALFABETO_TEMPORAL;
    salida += alfabeto.charAt(valor % alfabeto.length);
  }
  return salida;
}

/** Campos de Usuarios que nunca salen del servidor. */
var CAMPOS_USUARIO_PRIVADOS = ['password_hash', 'password_salt', 'password_iter'];

/** Copia del usuario sin los campos privados: lo único que puede viajar a un cliente. */
function usuarioPublico(usuario) {
  if (!usuario) return usuario;
  var copia = {};
  for (var k in usuario) {
    if (CAMPOS_USUARIO_PRIVADOS.indexOf(k) === -1) copia[k] = usuario[k];
  }
  copia.tiene_password = !!usuario.password_hash;
  return copia;
}

if (typeof module !== 'undefined') {
  module.exports = {
    PASSWORD_ITERACIONES: PASSWORD_ITERACIONES,
    normalizarUsuario: normalizarUsuario,
    validarPasswordNueva: validarPasswordNueva,
    derivarHashPassword: derivarHashPassword,
    compararSeguro: compararSeguro,
    generarPasswordTemporal: generarPasswordTemporal,
    usuarioPublico: usuarioPublico,
    CAMPOS_USUARIO_PRIVADOS: CAMPOS_USUARIO_PRIVADOS
  };
}
