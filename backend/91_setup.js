/**
 * 91_setup.js — inicializarSistema(): crea hojas, columnas faltantes, los dos
 * espacios compartidos (ESP_FAMILIA, ESP_TELCOM — docs/CONTRACT.md § 0.3), sus
 * categorías de sistema (§ 6-bis), sus cuentas por defecto, y da de alta a
 * todo usuario activo como miembro de ambos.
 * Idempotente: correrla varias veces no duplica nada.
 *
 * Se ejecuta a mano desde el editor de Apps Script (Ejecutar > inicializarSistema),
 * no está expuesta como acción del router.
 *
 * `OperacionesAplicadas` (docs/CONTRACT.md § 2 y § 4, idempotencia persistente
 * de `op_id`) no necesita código propio acá: como cualquier otra hoja nueva de
 * SHEETS, el loop de abajo la crea con sus columnas si todavía no existe.
 */

/**
 * Crea el PRIMER usuario propietario. Se ejecuta a mano desde el editor de Apps Script,
 * una sola vez, después de inicializarSistema().
 *
 * Existe porque `crearUsuario` exige sesión de propietario, y sin un propietario no hay
 * forma de conseguir esa sesión: el huevo y la gallina. Lee los datos de
 * PropertiesService (PROPIETARIO_EMAIL y PROPIETARIO_NOMBRE) en vez de pedir que se
 * edite el código, para no obligar a tocar el fuente ya pegado.
 *
 * Se niega a correr si ya existe un propietario: sin esa guardia, cualquiera con acceso
 * al editor podría convertirse en propietario ejecutándola de nuevo.
 */
function crearPropietarioInicial() {
  return withLock(function () {
    var email = String(getProp('PROPIETARIO_EMAIL') || '').trim().toLowerCase();
    var nombre = String(getProp('PROPIETARIO_NOMBRE') || '').trim();

    if (!email || !nombre) {
      throw new Error(
        'Faltan las propiedades PROPIETARIO_EMAIL y PROPIETARIO_NOMBRE. ' +
        'Cargalas en Configuración del proyecto > Propiedades del script y volvé a ejecutar.'
      );
    }

    var usuarios = getAllData(getSheet(SHEETS.USUARIOS));

    var yaHayPropietario = usuarios.some(function (u) {
      return u.rol_global === 'propietario' && u.activo;
    });
    if (yaHayPropietario) {
      throw new Error(
        'Ya existe un usuario propietario. Las altas siguientes se hacen desde la pantalla ' +
        'de Administración o con /agregar en el bot.'
      );
    }

    if (usuarios.some(function (u) { return String(u.email).toLowerCase() === email; })) {
      throw new Error('Ya existe un usuario con el email ' + email + '.');
    }

    var id = generateId('USR');
    var ahora = fechaHoraActual();

    anexarFila(getSheet(SHEETS.USUARIOS), {
      id_usuario: id,
      email: email,
      nombre: nombre,
      foto_perfil: '',
      google_id: '',
      telegram_chat_id: '',
      rol_global: 'propietario',
      moneda_principal: 'PEN',
      fecha_registro: ahora,
      ultima_sesion: '',
      activo: true
    });

    ESPACIOS_POR_DEFECTO.forEach(function (esp) {
      agregarMiembroEspacioInterno(id, esp.id, 'propietario');
    });

    Logger.log('Propietario creado: ' + nombre + ' <' + email + '> (' + id + ')');
    return respuestaExito({ id_usuario: id, email: email, nombre: nombre, rol_global: 'propietario' });
  });
}

function inicializarSistema() {
  return withLock(function () {
    var ss = SpreadsheetApp.openById(getProp('SPREADSHEET_ID'));
    var creadas = [];
    var migradas = [];

    Object.keys(SHEETS).forEach(function (clave) {
      var nombre = SHEETS[clave];
      var existiaAntes = !!ss.getSheetByName(nombre);
      var sheet = getSheet(nombre); // crea la hoja con headers si no existía.

      if (existiaAntes) {
        var actuales = obtenerEncabezados(sheet);
        var esperados = ESQUEMA_COLUMNAS[nombre];
        var faltaAlguna = esperados.some(function (h) { return actuales.indexOf(h) === -1; });
        if (faltaAlguna) {
          _asegurarColumnas(sheet, esperados);
          migradas.push(nombre);
        }
      } else {
        creadas.push(nombre);
      }
    });

    var reutilizoEspacioLegacy = _asegurarEspacios();

    ESPACIOS_POR_DEFECTO.forEach(function (esp) {
      crearCategoriasSistemaInterno(esp.id);
      crearCuentasPorDefectoInterno(esp.id);
    });

    _asegurarMembresiasTodosLosEspacios();

    return respuestaExito({
      hojas_creadas: creadas,
      hojas_migradas: migradas,
      espacios: ESPACIOS_POR_DEFECTO.map(function (e) { return e.id; }),
      espacio_legacy_reutilizado: reutilizoEspacioLegacy
    });
  });
}

/**
 * Agrega al final las columnas de `encabezadosEsperados` que falten en `sheet`,
 * sin tocar las existentes ni las filas de datos ya presentes (salvo rellenar
 * un valor por defecto razonable en la columna nueva).
 */
function _asegurarColumnas(sheet, encabezadosEsperados) {
  var actuales = obtenerEncabezados(sheet);

  if (actuales.length === 0) {
    sheet.getRange(1, 1, 1, encabezadosEsperados.length).setValues([encabezadosEsperados]);
    sheet.setFrozenRows(1);
    return;
  }

  var faltantes = encabezadosEsperados.filter(function (h) { return actuales.indexOf(h) === -1; });
  if (faltantes.length === 0) return;

  var colInicio = actuales.length + 1;
  sheet.getRange(1, colInicio, 1, faltantes.length).setValues([faltantes]);

  var ultimaFila = sheet.getLastRow();
  if (ultimaFila >= 2) {
    faltantes.forEach(function (nombreCol, i) {
      var valorDefecto = _valorDefectoColumnaNueva(nombreCol);
      if (valorDefecto === undefined) return;

      var col = colInicio + i;
      var valores = [];
      for (var f = 0; f < ultimaFila - 1; f++) valores.push([valorDefecto]);
      sheet.getRange(2, col, ultimaFila - 1, 1).setValues(valores);
    });
  }
}

/**
 * Valor por defecto para columnas agregadas por este contrato (rev/origen/eliminado,
 * y ahora `grupo` en Categorias — docs/CONTRACT.md § 2) sobre filas que ya
 * existían en el legacy. La limpieza fina de datos corruptos (#NUM!, espacio
 * huérfano ESP001, etc.) es responsabilidad de backend/90_migracion.js.
 */
function _valorDefectoColumnaNueva(nombreCol) {
  if (nombreCol === 'rev') return 1;
  if (nombreCol === 'origen') return 'migracion';
  if (nombreCol === 'eliminado') return false;
  // `grupo` (Categorias): vacío por defecto. Es exactamente el valor correcto
  // para las categorías preexistentes de Familia (§ 6-bis: grupo='' ahí); las
  // de Telcom nunca preexisten porque el espacio es nuevo en esta versión.
  if (nombreCol === 'grupo') return '';
  // No se conoce la última modificación real de una fila que ya existía antes
  // de agregar la columna: se marca con el momento de la migración, igual que
  // `origen = 'migracion'`. Sí entra en el filtro incremental de `sincronizar`
  // desde ese momento en adelante.
  if (nombreCol === 'fecha_modificacion') return fechaHoraActual();
  return undefined;
}

/**
 * Crea ESP_FAMILIA y ESP_TELCOM si no existen (docs/CONTRACT.md § 0.3).
 *
 * Reutilización del `ESP_COMPARTIDO` de la versión anterior (espacio único):
 * si existe una fila `ESP_COMPARTIDO` en Espacios y todavía no existe
 * `ESP_FAMILIA`, se RENOMBRA esa fila a `ESP_FAMILIA` en vez de crear un
 * espacio nuevo vacío — así todas las cuentas, categorías, transacciones,
 * deudas, etc. que ya tenía el espacio único quedan directamente en Familia,
 * sin dejar data huérfana. El cascadeo de `id_espacio = 'ESP_COMPARTIDO'` a
 * `'ESP_FAMILIA'` en el resto de las hojas ocurre en la misma pasada.
 *
 * → true si hubo reutilización/renombrado, false si no (incluye el caso de
 * una instalación nueva sin `ESP_COMPARTIDO` previo).
 */
function _asegurarEspacios() {
  var sheet = getSheet(SHEETS.ESPACIOS);
  var idLegacy = 'ESP_COMPARTIDO';
  var filaLegacy = buscarPorId(sheet, 'id_espacio', idLegacy);
  var yaFamilia = buscarPorId(sheet, 'id_espacio', ESP_FAMILIA_ID);
  var reutilizo = false;

  if (filaLegacy && !yaFamilia) {
    sheet.getRange(filaLegacy.row, filaLegacy.headers.indexOf('id_espacio') + 1).setValue(ESP_FAMILIA_ID);
    _renombrarIdEspacioEnTodasLasHojas(idLegacy, ESP_FAMILIA_ID);
    reutilizo = true;
  }

  ESPACIOS_POR_DEFECTO.forEach(function (esp) {
    var fila = buscarPorId(sheet, 'id_espacio', esp.id);
    if (fila) return;

    anexarFila(sheet, {
      id_espacio: esp.id,
      nombre: esp.nombre,
      descripcion: esp.descripcion,
      id_propietario: '', // el rol lo gobierna Usuarios.rol_global, no este campo.
      icono: esp.icono,
      color: esp.color,
      fecha_creacion: fechaHoraActual(),
      activo: true
    });
  });

  return reutilizo;
}

/**
 * Reescribe `id_espacio` de `idViejo` a `idNuevo` en toda hoja cuyo esquema
 * (ESQUEMA_COLUMNAS) tenga esa columna. Uso interno de `_asegurarEspacios`
 * para la reutilización del ESP_COMPARTIDO legacy.
 */
function _renombrarIdEspacioEnTodasLasHojas(idViejo, idNuevo) {
  Object.keys(SHEETS).forEach(function (clave) {
    var nombre = SHEETS[clave];
    if (nombre === SHEETS.ESPACIOS) return; // ya renombrado en _asegurarEspacios.

    var esquema = ESQUEMA_COLUMNAS[nombre];
    if (!esquema || esquema.indexOf('id_espacio') === -1) return;

    var sheet = getSheet(nombre);
    var headers = obtenerEncabezados(sheet);
    var colEspacio = headers.indexOf('id_espacio');
    if (colEspacio === -1) return;

    var ultimaFila = sheet.getLastRow();
    if (ultimaFila < 2) return;

    var rango = sheet.getRange(2, colEspacio + 1, ultimaFila - 1, 1);
    var valores = rango.getValues();
    var cambiaron = false;
    for (var i = 0; i < valores.length; i++) {
      if (valores[i][0] === idViejo) {
        valores[i][0] = idNuevo;
        cambiaron = true;
      }
    }
    if (cambiaron) rango.setValues(valores);
  });
}

/**
 * Da de alta a todo usuario activo como miembro de AMBOS espacios
 * (docs/CONTRACT.md § 0.3: "Todos los miembros activos pertenecen a los
 * dos"). Idempotente vía agregarMiembroEspacioInterno.
 */
function _asegurarMembresiasTodosLosEspacios() {
  var usuarios = getAllData(getSheet(SHEETS.USUARIOS)).filter(function (u) { return u.activo; });
  usuarios.forEach(function (u) {
    ESPACIOS_POR_DEFECTO.forEach(function (esp) {
      agregarMiembroEspacioInterno(u.id_usuario, esp.id, 'miembro');
    });
  });
}
