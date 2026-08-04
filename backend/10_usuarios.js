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
  var validacion = validarRequeridos(datos, ['nombre', 'email']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var email = sanearTexto(datos.email, 200).toLowerCase();
  var nombre = sanearTexto(datos.nombre, 200);

  var sheet = getSheet(SHEETS.USUARIOS);
  var existentes = getAllData(sheet);
  var yaExiste = existentes.some(function (u) { return String(u.email).toLowerCase() === email && u.activo; });

  if (yaExiste) {
    return respuestaError('EMAIL_DUPLICADO', 'Ese email ya está registrado y activo.');
  }

  var rolValidacion = validarTipo(datos.rol_global || 'miembro', ['propietario', 'miembro']);
  if (!rolValidacion.valido) return respuestaError(rolValidacion.error, 'rol_global inválido.');

  return withLock(function () {
    var id = generateId('USR');
    var ahora = fechaHoraActual();

    anexarFila(sheet, {
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
      activo: true
    });

    ESPACIOS_POR_DEFECTO.forEach(function (esp) {
      agregarMiembroEspacioInterno(id, esp.id, 'miembro');
    });

    return respuestaExito({ id_usuario: id });
  });
}

function getUsuario(idUsuario) {
  var sheet = getSheet(SHEETS.USUARIOS);
  var fila = buscarPorId(sheet, 'id_usuario', idUsuario);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Usuario no encontrado.');
  return respuestaExito({ usuario: fila.datos });
}

/** getUsuarios() → todos los usuarios activos del espacio compartido (grupo único). */
function getUsuarios() {
  var sheet = getSheet(SHEETS.USUARIOS);
  var usuarios = getAllData(sheet).filter(function (u) { return u.activo; });
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

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, datos, ['id_usuario', 'fecha_registro', 'email']);
    var actualizado = buscarPorId(sheet, 'id_usuario', datos.id_usuario);
    return respuestaExito({ usuario: actualizado.datos });
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
