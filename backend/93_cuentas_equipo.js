/**
 * 93_cuentas_equipo.js — alta de las cuentas reales del equipo (docs/DESPLIEGUE.md § 6).
 *
 * Se ejecuta UNA vez desde el editor de Apps Script (crearCuentasEquipo). La contraseña inicial
 * NO está en el código (el repositorio es público): se carga antes como propiedad del script
 * `PASSWORD_INICIAL`, y la función la borra al terminar. Queda como temporal: cada persona tiene
 * que cambiarla al entrar por primera vez (debe_cambiar_password = true).
 *
 * Jael y Yubert ya tenían usuario (entraban con Google): se reutilizan sus filas por id, así
 * conservan su historial y siguen pudiendo entrar con Google además de con contraseña.
 * Idempotente: si la cuenta ya existe, la actualiza en vez de duplicarla.
 */

var EQUIPO_INICIAL = [
  { usuario: 'jael', nombre: 'Jael Canaza', rol: 'propietario', id_existente: 'USR_70e99eca' },
  { usuario: 'yubert', nombre: 'Yubert Canaza', rol: 'propietario', id_existente: 'USR_11637e33' },
  { usuario: 'darwin', nombre: 'Darwin Canaza', rol: 'miembro' },
  { usuario: 'willy', nombre: 'Willy Canaza', rol: 'miembro' }
];

function crearCuentasEquipo() {
  var props = PropertiesService.getScriptProperties();
  var password = props.getProperty('PASSWORD_INICIAL');
  if (!password) {
    throw new Error('Falta la propiedad PASSWORD_INICIAL. Cárgala en Configuración del proyecto → Propiedades del script y vuelve a ejecutar.');
  }

  var resultado = withLock(function () {
    var sheet = getSheet(SHEETS.USUARIOS);
    var hechos = [];

    EQUIPO_INICIAL.forEach(function (p) {
      var v = validarPasswordNueva(password, { usuario: p.usuario, nombre: p.nombre });
      if (!v.valido) throw new Error('PASSWORD_INICIAL no sirve para ' + p.usuario + ': ' + v.detalle);

      var todos = getAllData(sheet);
      var existente = (p.id_existente && todos.filter(function (u) { return u.id_usuario === p.id_existente; })[0]) ||
        todos.filter(function (u) { return String(u.usuario || '').toLowerCase() === p.usuario; })[0];
      var campos = camposPassword(password, true);
      campos.usuario = p.usuario;
      campos.rol_global = p.rol;
      campos.activo = true;

      var idUsuario;
      if (existente) {
        idUsuario = existente.id_usuario;
        var fila = buscarPorId(sheet, 'id_usuario', idUsuario);
        // El nombre solo se completa si estaba vacío o genérico: no se pisa lo que ya puso la persona.
        if (!existente.nombre || existente.nombre === 'Yubert') campos.nombre = p.nombre;
        escribirCampos(sheet, fila.row, fila.headers, campos, ['id_usuario', 'fecha_registro', 'email']);
        hechos.push(p.usuario + ': actualizado (' + idUsuario + ')');
      } else {
        idUsuario = generateId('USR');
        var nueva = {
          id_usuario: idUsuario, email: '', nombre: p.nombre, foto_perfil: '', google_id: '', telegram_chat_id: '',
          moneda_principal: 'PEN', fecha_registro: fechaHoraActual(), ultima_sesion: ''
        };
        for (var k in campos) nueva[k] = campos[k];
        anexarFila(sheet, nueva);
        hechos.push(p.usuario + ': creado (' + idUsuario + ')');
      }

      ESPACIOS_POR_DEFECTO.forEach(function (esp) {
        agregarMiembroEspacioInterno(idUsuario, esp.id, p.rol === 'propietario' ? 'propietario' : 'miembro');
      });
    });

    return hechos;
  });

  // Fuera del lock y pase lo que pase con el registro: la contraseña no se queda guardada.
  props.deleteProperty('PASSWORD_INICIAL');
  Logger.log(resultado.join('\n') + '\nPASSWORD_INICIAL borrada. Cada persona debe cambiar su contraseña al entrar.');
  return resultado;
}
