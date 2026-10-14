/**
 * 10_usuarios.js — alta, baja lógica y edición de usuarios.
 * crearUsuario / desactivarUsuario: solo rol_global='propietario' (guardia en el router).
 */

/**
 * crearUsuario(datos) → { id_usuario }
 * NO crea espacio propio: agrega al usuario como miembro de AMBOS espacios
 * compartidos, Familia y Telcom (docs/CONTRACT.md § 0.3).
 */
function crearUsuario(datos) {
  var validacion = validarRequeridos(datos, ['nombre']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  // Hace falta al menos una forma de entrar: email (Google) o usuario (contraseña, § 0.1-bis).
  var email = sanearTexto(datos.email, 200).toLowerCase();
  var nombreUsuario = datos.usuario ? normalizarUsuario(datos.usuario) : '';
  if (datos.usuario && !nombreUsuario) {
    return respuestaError('CAMPO_REQUERIDO', 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo, sin espacios.');
  }
  if (!email && !nombreUsuario) return respuestaError('CAMPO_REQUERIDO', 'falta: usuario o email');
  var nombre = sanearTexto(datos.nombre, 200);

  var sheet = getSheet(SHEETS.USUARIOS);
  var existentes = getAllData(sheet);
  if (email && existentes.some(function (u) { return String(u.email).toLowerCase() === email && u.activo; })) {
    return respuestaError('EMAIL_DUPLICADO', 'Ese email ya está registrado y activo.');
  }
  // Único entre activos e inactivos: reusar el nombre de alguien dado de baja confundiría la auditoría.
  if (nombreUsuario && existentes.some(function (u) { return String(u.usuario || '').toLowerCase() === nombreUsuario; })) {
    return respuestaError('USUARIO_DUPLICADO', 'Ese usuario ya existe. Elige otro.');
  }

  var rolValidacion = validarTipo(datos.rol_global || 'miembro', ['propietario', 'miembro']);
  if (!rolValidacion.valido) return respuestaError(rolValidacion.error, 'rol_global inválido.');

  return withLock(function () {
    var id = generateId('USR');
    var ahora = fechaHoraActual();
    var passwordTemporal = nombreUsuario ? nuevaPasswordTemporal() : '';

    var fila = {
      id_usuario: id,
      email: email,
      nombre: nombre,
      foto_perfil: sanearTexto(datos.foto_perfil, 500) || '',
      google_id: sanearTexto(datos.google_id, 100) || '',
      telegram_chat_id: sanearTexto(datos.telegram_chat_id, 50) || '',
      rol_global: rolValidacion.valor,
      moneda_principal: sanearTexto(datos.moneda_principal, 10) || 'PEN',
      fecha_registro: ahora,
      ultima_sesion: '',
      activo: true,
      usuario: nombreUsuario
    };
    if (passwordTemporal) {
      var pw = camposPassword(passwordTemporal, true);
      for (var k in pw) fila[k] = pw[k];
    }
    anexarFila(sheet, fila);

    ESPACIOS_POR_DEFECTO.forEach(function (esp) {
      agregarMiembroEspacioInterno(id, esp.id, 'miembro');
    });

    // La contraseña temporal se devuelve UNA sola vez, para que el propietario se la entregue.
    // En la hoja solo queda el hash; si se pierde, se restablece.
    return respuestaExito({ id_usuario: id, usuario: usuarioPublico(fila), password_temporal: passwordTemporal || undefined });
  });
}

/** restablecerPassword({ id_usuario }) — solo propietario. Nueva temporal, obliga a cambiarla. */
function restablecerPassword(datos) {
  var req = validarRequeridos(datos, ['id_usuario']);
  if (!req.valido) return respuestaError(req.error, req.detalle);
  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', datos.id_usuario);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Usuario no encontrado.');
  if (!fila.datos.usuario) return respuestaError('CAMPO_REQUERIDO', 'Ese usuario entra con Google: asígnale un nombre de usuario primero.');

  return withLock(function () {
    var temporal = nuevaPasswordTemporal();
    escribirCampos(sheet, fila.row, fila.headers, camposPassword(temporal, true), ['id_usuario']);
    CacheService.getScriptCache().remove('intentos_' + String(fila.datos.usuario).toLowerCase());
    return respuestaExito({ id_usuario: datos.id_usuario, password_temporal: temporal });
  });
}

function getUsuario(idUsuario) {
  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', idUsuario);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Usuario no encontrado.');
  return respuestaExito({ usuario: usuarioPublico(fila.datos) });
}

/** getUsuarios() → todos los usuarios activos del espacio compartido (grupo único). */
function getUsuarios() {
  var sheet = getSheet(SHEETS.USUARIOS);
  var usuarios = getAllData(sheet).filter(function (u) { return u.activo; }).map(usuarioPublico);
  return respuestaExito({ usuarios: usuarios });
}

/**
 * actualizarUsuario(datos, usuarioSesion) — cualquiera puede editar su propio
 * perfil; solo el propietario puede editar el de otros o cambiar rol_global.
 */
function actualizarUsuario(datos, usuarioSesion) {
  var validacion = validarRequeridos(datos, ['id_usuario']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var esPropio = usuarioSesion && usuarioSesion.id_usuario === datos.id_usuario;
  var esPropietario = usuarioSesion && usuarioSesion.rol_global === 'propietario';

  if (!esPropio && !esPropietario) {
    return respuestaError('SIN_PERMISO', 'Solo puedes editar tu propio perfil.');
  }
  if (datos.rol_global !== undefined && !esPropietario) {
    return respuestaError('SIN_PERMISO', 'Solo el propietario puede cambiar el rol de un usuario.');
  }

  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', datos.id_usuario);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Usuario no encontrado.');

  // Lista blanca: antes se escribía `datos` tal cual, y cualquiera podía tocar `activo` del
  // propio perfil (y, con contraseñas, su hash). Lo que no está acá no se escribe.
  var permitidos = esPropietario
    ? ['nombre', 'foto_perfil', 'moneda_principal', 'telegram_chat_id', 'rol_global', 'usuario']
    : ['nombre', 'foto_perfil', 'moneda_principal'];
  var cambios = {};
  permitidos.forEach(function (campo) { if (datos[campo] !== undefined) cambios[campo] = datos[campo]; });
  if (cambios.nombre !== undefined) cambios.nombre = sanearTexto(cambios.nombre, 200);
  if (cambios.usuario !== undefined) {
    var nuevoUsuario = normalizarUsuario(cambios.usuario);
    if (!nuevoUsuario) return respuestaError('CAMPO_REQUERIDO', 'Usuario inválido.');
    var ocupado = getAllData(sheet).some(function (u) { return u.id_usuario !== datos.id_usuario && String(u.usuario || '').toLowerCase() === nuevoUsuario; });
    if (ocupado) return respuestaError('USUARIO_DUPLICADO', 'Ese usuario ya existe. Elige otro.');
    cambios.usuario = nuevoUsuario;
  }

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, cambios, ['id_usuario', 'fecha_registro', 'email']);
    var actualizado = buscarPorId(sheet, 'id_usuario', datos.id_usuario);
    return respuestaExito({ usuario: usuarioPublico(actualizado.datos) });
  });
}

/**
 * desactivarUsuario(datos) — baja lógica (activo=false). Solo propietario.
 */
function desactivarUsuario(datos) {
  var validacion = validarRequeridos(datos, ['id_usuario']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', datos.id_usuario);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Usuario no encontrado.');

  return withLock(function () {
    var colActivo = fila.headers.indexOf('activo');
    sheet.getRange(fila.row, colActivo + 1).setValue(false);
    desactivarMiembroEspacioInterno(datos.id_usuario);
    return respuestaExito({ id_usuario: datos.id_usuario });
  });
}
