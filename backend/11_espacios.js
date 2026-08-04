/**
 * 11_espacios.js — los dos espacios compartidos (ESP_FAMILIA, ESP_TELCOM) y su
 * membresía (docs/CONTRACT.md § 0.3). No hay espacios personales: crearEspacio
 * no es una acción del router, los dos espacios se crean una sola vez desde
 * 91_setup.js. Todo miembro activo pertenece a los dos.
 */

/**
 * getEspacio(idEspacio) — requiere id_espacio explícito: ya no existe un
 * espacio compartido único que asumir por defecto.
 */
function getEspacio(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.ESPACIOS);
  var fila = buscarPorId(sheet, 'id_espacio', idEspacio);

  if (!fila) return respuestaError('NO_ENCONTRADO', 'Espacio no encontrado.');
  return respuestaExito({ espacio: fila.datos });
}

/**
 * getEspacios(usuarioSesion) — los espacios de los que el usuario de la sesión
 * es miembro activo. Nunca devuelve espacios ajenos (docs/CONTRACT.md § 3).
 */
function getEspacios(usuarioSesion) {
  if (!usuarioSesion) return respuestaError('SESION_INVALIDA', 'Tu sesión expiró o no existe.');

  var miembros = getAllData(getSheet(SHEETS.MIEMBROS_ESPACIO)).filter(function (m) {
    return m.id_usuario === usuarioSesion.id_usuario && m.activo;
  });
  var espacios = getAllData(getSheet(SHEETS.ESPACIOS)).filter(function (e) { return e.activo; });

  var resultado = miembros
    .map(function (m) { return espacios.filter(function (e) { return e.id_espacio === m.id_espacio; })[0]; })
    .filter(function (e) { return !!e; });

  return respuestaExito({ espacios: resultado });
}

/**
 * actualizarEspacio(datos) — solo propietario (guardia en el router), que
 * también valida que sea miembro del espacio que edita.
 */
function actualizarEspacio(datos) {
  var validacion = validarRequeridos(datos, ['id_espacio']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var sheet = getSheet(SHEETS.ESPACIOS);
  var fila = buscarPorId(sheet, 'id_espacio', datos.id_espacio);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Espacio no encontrado.');

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, datos, ['id_espacio', 'fecha_creacion']);
    var actualizado = buscarPorId(sheet, 'id_espacio', datos.id_espacio);
    return respuestaExito({ espacio: actualizado.datos });
  });
}

/**
 * getMiembros(idEspacio) → miembros activos del espacio, con datos básicos de usuario.
 */
function getMiembros(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var miembrosSheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  var usuariosSheet = getSheet(SHEETS.USUARIOS);

  var miembros = getAllData(miembrosSheet).filter(function (m) { return m.id_espacio === idEspacio && m.activo; });
  var usuarios = getAllData(usuariosSheet);

  var resultado = miembros.map(function (m) {
    var usuario = usuarios.filter(function (u) { return u.id_usuario === m.id_usuario; })[0];
    return {
      id_miembro: m.id_miembro,
      id_espacio: m.id_espacio,
      id_usuario: m.id_usuario,
      rol: m.rol,
      fecha_union: m.fecha_union,
      activo: m.activo,
      nombre: usuario ? usuario.nombre : null,
      email: usuario ? usuario.email : null,
      foto_perfil: usuario ? usuario.foto_perfil : null
    };
  });

  return respuestaExito({ miembros: resultado });
}

/**
 * Agrega un usuario como miembro de `idEspacio`. Uso interno (llamado por
 * crearUsuario en 10_usuarios.js, para AMBOS espacios, y por 91_setup.js al
 * dar de alta a todo usuario activo en los dos). Idempotente: si ya es
 * miembro activo de ese espacio, no duplica.
 */
function agregarMiembroEspacioInterno(idUsuario, idEspacio, rol) {
  var sheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  var existentes = getAllData(sheet);
  var yaEsMiembro = existentes.some(function (m) {
    return m.id_espacio === idEspacio && m.id_usuario === idUsuario && m.activo;
  });

  if (yaEsMiembro) return;

  anexarFila(sheet, {
    id_miembro: generateId('MBR'),
    id_espacio: idEspacio,
    id_usuario: idUsuario,
    rol: rol || 'miembro',
    fecha_union: fechaHoraActual(),
    activo: true
  });
}

/**
 * Desactiva la membresía de un usuario en TODOS los espacios (uso interno,
 * llamado por desactivarUsuario en 10_usuarios.js): un usuario dado de baja
 * pierde acceso a Familia y a Telcom por igual.
 */
function desactivarMiembroEspacioInterno(idUsuario) {
  var sheet = getSheet(SHEETS.MIEMBROS_ESPACIO);
  var data = getAllData(sheet);
  var headers = obtenerEncabezados(sheet);
  var colActivo = headers.indexOf('activo');

  for (var i = 0; i < data.length; i++) {
    if (data[i].id_usuario === idUsuario && data[i].activo) {
      sheet.getRange(i + 2, colActivo + 1).setValue(false);
    }
  }
}
