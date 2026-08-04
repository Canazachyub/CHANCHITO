/**
 * 90_migracion.js — migración de la data legacy (Chanchito v1 / Code.legacy.gs)
 * al esquema v2 (docs/CONTRACT.md § 2). Es una operación administrativa de una
 * sola vez, que se corre primero en modo simulación y después en modo real
 * (ver docs/SETUP.md, paso "Migración de datos existentes").
 *
 * Requiere haber corrido inicializarSistema() antes (backend/91_setup.js):
 * ese paso ya agrega las columnas rev/origen/eliminado/canal que falten, crea
 * los DOS espacios compartidos (`ESP_FAMILIA` y `ESP_TELCOM`, docs/CONTRACT.md
 * § 0.3) con sus categorías de sistema, y ya rellena rev=1/origen='migracion'/
 * eliminado=false en cualquier fila legacy a la que le falten esas columnas
 * (ver el comentario de `_valorDefectoColumnaNueva` en 91_setup.js). Por eso
 * esta migración NO repite ese relleno: se ocupa específicamente de lo que
 * 91_setup.js señala como fuera de su alcance:
 *
 *   1. Descartar filas corruptas (#NUM!/#REF!/#VALUE!/monto no numérico) en
 *      Transacciones, Deudas y Presupuestos — el bug de README § 14.
 *   2. Descartar el/los espacio(s) personal(es) — incluido el huérfano
 *      `ESP001` — y reasignar TODO lo que colgaba de ellos a un único espacio
 *      destino configurable (`espacio_destino`, ver más abajo), conservando
 *      `id_usuario`. Se reasignan también Cuentas/Categorías/GastosRecurrentes/
 *      Etiquetas: si no, una transacción migrada quedaría apuntando a una
 *      cuenta o categoría que sigue en el espacio descartado y las pantallas
 *      que filtran por `id_espacio` (getCuentas, getCategorias, ...) no la
 *      encontrarían — el registro se vería "roto" aunque la transacción en sí
 *      se haya migrado bien.
 *   3. Rellenar `grupo` (docs/CONTRACT.md § 2, columna nueva de Categorias) en
 *      las categorías reasignadas, cuando el nombre matchea uno de los grupos
 *      documentados en § 6-bis para Telcom. Si no se puede inferir, o el
 *      destino es Familia (que no agrupa), queda `''` — nunca se inventa un
 *      grupo.
 *   4. Rellenar `canal = 'app'` en Notificaciones que quedaron sin ese campo
 *      (91_setup.js deliberadamente no pone un valor por defecto ahí).
 *
 * ### Por qué Telcom es el destino por defecto
 *
 * El archivo real de origen (`APPTELCOMAHORRO.xlsx`, no incluido en este repo)
 * es la contabilidad de la empresa Telcom, no del gasto familiar de la casa.
 * Migrar esa data al espacio equivocado por defecto mezclaría facturación de
 * empresa con mercado de casa — exactamente el problema que motivó separar
 * los espacios (docs/CONTRACT.md § 0.3). Por eso el destino por defecto de
 * TODO registro reasignado es `ESP_TELCOM`, no `ESP_FAMILIA`.
 *
 * Es configurable con el parámetro `espacio_destino` (`'ESP_TELCOM'` por
 * defecto, o `'ESP_FAMILIA'`) por si algún día se migra un archivo distinto
 * cuya data sea efectivamente familiar. Un valor fuera de esas dos opciones
 * devuelve `ESPACIO_INVALIDO` (docs/CONTRACT.md § 3) sin tocar nada.
 *
 * Nada se descarta en silencio: cada fila tocada queda en la hoja `MigracionLog`
 * (fecha, entidad, id, acción, motivo) y también viaja en la respuesta JSON.
 *
 * Idempotente por diseño de estado, no por bitácora: cada paso primero revisa
 * si la fila YA está en el estado final (eliminado=true, id_espacio ya es uno
 * de los dos espacios válidos, canal ya asignado) y si es así no hace nada ni
 * vuelve a loguearla. Correr la migración dos veces no duplica nada ni pisa
 * ediciones reales hechas después del lanzamiento.
 *
 * NO está en ACCIONES_GET/ACCIONES_POST (backend/01_router.js): es una acción
 * administrativa que el router especial-casea por nombre (`ejecutarMigracion`)
 * y llama ANTES de validar SHARED_TOKEN (igual que telegramWebhook, ver
 * 01_router.js línea ~120). Por eso esta función valida su propio token acá
 * — si no lo hiciera, cualquiera con la URL del Web App podría disparar la
 * migración real sin autenticarse.
 *
 * TODO(contrato): el archivo real `APPTELCOMAHORRO.xlsx` (pestañas Deudas y
 * Presupuestos de la empresa) no está en este repo. Esta migración está
 * escrita contra el esquema documentado en CONTRACT.md § 2 y contra el
 * comportamiento real de esFilaCorrupta/validarMonto (backend/lib_validacion.js),
 * no contra datos reales — se reporta al terminar; falta correrla contra el
 * spreadsheet real para confirmar que cubre todos los casos de corrupción y
 * de nombres de categoría presentes ahí (la inferencia de `grupo` por nombre,
 * en particular, depende de que los nombres de categoría legacy coincidan con
 * los de § 6-bis).
 *
 * Prefijo `mig` en todo lo interno (funciones Y constantes) para no chocar en
 * el scope global de Apps Script; `migrarDatos` es el único nombre que llama
 * el router.
 */

// Los dos espacios compartidos válidos (docs/CONTRACT.md § 0.3). Se usan los
// IDs literales, no un global de 00_config.js: ese archivo lo está tocando en
// paralelo otro agente (ver CONTRACT.md § 0.3, "ESPACIO_COMPARTIDO_ID deja de
// existir como constante") y no hay contrato todavía sobre qué nombre de
// variable global va a exponer para cada uno, así que depender de un global
// ajeno acá arriesgaría un ReferenceError en producción. Si más adelante
// 00_config.js expone constantes equivalentes, este archivo se puede migrar
// a usarlas sin más cambio que reemplazar estos dos valores.
var MIG_ESP_FAMILIA_ID = 'ESP_FAMILIA';
var MIG_ESP_TELCOM_ID = 'ESP_TELCOM';
var MIG_ESPACIOS_VALIDOS = [MIG_ESP_FAMILIA_ID, MIG_ESP_TELCOM_ID];

// Destino por defecto de la data histórica migrada: ver "Por qué Telcom es el
// destino por defecto" en el comentario de arriba.
var MIG_ESPACIO_DESTINO_DEFECTO = MIG_ESP_TELCOM_ID;

// Inferencia de `grupo` (docs/CONTRACT.md § 6-bis) por nombre de categoría,
// solo aplicable cuando el destino es ESP_TELCOM — en ESP_FAMILIA el grupo
// queda siempre '' (11 categorías no necesitan agrupar). Nombres normalizados
// (minúsculas, sin tildes) para no fallar por una diferencia de mayúsculas o
// acentos entre la planilla legacy y el contrato.
var MIG_GRUPO_POR_CATEGORIA_TELCOM = {
  'notaria y tramites': 'operativos',
  'servicios tecnicos': 'operativos',
  'viaticos': 'operativos',
  'pasajes y transporte': 'operativos',
  'materiales de trabajo': 'operativos',
  'combustible': 'operativos',
  'alquiler de oficina': 'operativos',
  'servicios de oficina': 'operativos',
  'sueldos y honorarios': 'personal',
  'facturas de trabajadores': 'personal',
  'adelantos': 'personal',
  'cts': 'personal',
  'essalud': 'personal',
  'seguros': 'personal',
  'gratificaciones': 'personal',
  'muebles y enseres': 'activos',
  'equipos de computo': 'activos',
  'utiles de oficina': 'activos',
  'impuestos y sunat': 'impuestos',
  'servicios facturados': 'ingresos',
  'otros ingresos': 'ingresos'
  // 'otros gastos operativos' queda deliberadamente sin grupo (§ 6-bis: "—").
};

// Entidades sincronizables: además de la limpieza de corrupción, se les
// reasigna id_espacio (conservan rev/origen/eliminado ya puestos por
// inicializarSistema()).
var MIG_ENTIDADES_SYNC = [
  { hoja: SHEETS.TRANSACCIONES, idCampo: 'id_transaccion', camposNum: ['monto'] },
  { hoja: SHEETS.DEUDAS, idCampo: 'id_deuda', camposNum: ['monto_original', 'monto_pendiente'] },
  { hoja: SHEETS.PRESUPUESTOS, idCampo: 'id_presupuesto', camposNum: ['monto_limite'] }
];

// Entidades con id_espacio pero sin rev/origen/eliminado (no son sincronizables):
// solo se les reasigna id_espacio para no dejar referencias huérfanas.
var MIG_ENTIDADES_ESPACIO_SIMPLE = [
  { hoja: SHEETS.CUENTAS, idCampo: 'id_cuenta' },
  { hoja: SHEETS.CATEGORIAS, idCampo: 'id_categoria' },
  { hoja: SHEETS.GASTOS_RECURRENTES, idCampo: 'id_gasto_recurrente' },
  { hoja: SHEETS.ETIQUETAS, idCampo: 'id_etiqueta' }
];

/**
 * migrarDatos(params) — acción `ejecutarMigracion` (POST).
 *
 * Va por la tabla normal del router con guardia `propietario`, así que para
 * cuando llega acá ya se validaron el SHARED_TOKEN y la sesión: reescribe data
 * histórica, no puede quedar más expuesta que un `crearUsuario`.
 *
 * Parámetros:
 *   - `dry_run`: default true. Solo `dry_run=false` explícito (string o
 *     booleano) habilita el modo que escribe.
 *   - `espacio_destino`: default `'ESP_TELCOM'` (ver comentario de cabecera).
 *     Acepta `'ESP_TELCOM'` o `'ESP_FAMILIA'`; cualquier otro valor devuelve
 *     `ESPACIO_INVALIDO` sin tocar nada.
 *
 * Se devuelve el objeto plano; el router lo envuelve con jsonResponse.
 */
function migrarDatos(params) {
  params = params || {};

  var dryRun = !(params.dry_run === false || params.dry_run === 'false');

  var espacioDestino = params.espacio_destino || MIG_ESPACIO_DESTINO_DEFECTO;
  if (MIG_ESPACIOS_VALIDOS.indexOf(espacioDestino) === -1) {
    return respuestaError(
      'ESPACIO_INVALIDO',
      'espacio_destino debe ser uno de: ' + MIG_ESPACIOS_VALIDOS.join(', ') + ' (recibido: "' + espacioDestino + '").'
    );
  }

  var espaciosSheet = getSheet(SHEETS.ESPACIOS);
  var faltantes = MIG_ESPACIOS_VALIDOS.filter(function (id) { return !buscarPorId(espaciosSheet, 'id_espacio', id); });
  if (faltantes.length > 0) {
    return respuestaError(
      'ERROR_INTERNO',
      'Faltan espacios por crear (' + faltantes.join(', ') + '). Corré inicializarSistema() primero (docs/SETUP.md).'
    );
  }

  try {
    if (dryRun) {
      return respuestaExito(migEjecutar(true, espacioDestino));
    }
    return withLock(function () {
      return respuestaExito(migEjecutar(false, espacioDestino));
    });
  } catch (error) {
    registrarErrorSistema('Error en migrarDatos: ' + error.toString(), { dry_run: dryRun, espacio_destino: espacioDestino });
    reportarSentry(error, { fuente: 'migrarDatos' });
    return respuestaError('ERROR_INTERNO', error.toString());
  }
}

/**
 * Corre los pasos de la migración contra un único `espacioDestino`. Con
 * `dryRun=true` no escribe nada en ninguna hoja (incluida MigracionLog): solo
 * arma el mismo `detalle` que escribiría el modo real, para poder revisarlo
 * antes de aplicarlo.
 */
function migEjecutar(dryRun, espacioDestino) {
  var resumen = { migrados: 0, descartados: 0 };
  var detalle = [];

  function registrar(entidad, id, accion, motivo) {
    detalle.push({ fecha: fechaHoraActual(), entidad: entidad, id: id, accion: accion, motivo: motivo });
    if (accion === 'migrado') resumen.migrados++;
    else if (accion === 'descartado') resumen.descartados++;
  }

  migProcesarEspaciosPersonales(dryRun, registrar);

  MIG_ENTIDADES_SYNC.forEach(function (config) {
    migProcesarEntidadSync(config, dryRun, espacioDestino, registrar);
  });

  MIG_ENTIDADES_ESPACIO_SIMPLE.forEach(function (config) {
    migProcesarEntidadEspacioSimple(config, dryRun, espacioDestino, registrar);
  });

  migProcesarCanalNotificaciones(dryRun, registrar);

  if (!dryRun) {
    migEscribirLog(detalle);
  }

  return { dry_run: dryRun, espacio_destino: espacioDestino, resumen: resumen, detalle: detalle };
}

/**
 * Desactiva cualquier espacio que no sea uno de los dos válidos — el huérfano
 * `ESP001` y cualquier espacio personal que haya quedado de "un espacio por
 * usuario" del legacy (README § 14). No se borra la fila (Espacios no es
 * sincronizable pero tampoco hay motivo para perder el historial): se marca
 * `activo=false`.
 */
function migProcesarEspaciosPersonales(dryRun, registrar) {
  var sheet = getSheet(SHEETS.ESPACIOS);
  var filas = getAllData(sheet);

  filas.forEach(function (espacio) {
    if (MIG_ESPACIOS_VALIDOS.indexOf(espacio.id_espacio) !== -1) return;
    if (espacio.activo === false) return; // ya desactivado (esta migración u otra causa).

    if (!dryRun) {
      var fila = buscarPorId(sheet, 'id_espacio', espacio.id_espacio);
      if (fila) escribirCampos(sheet, fila.row, fila.headers, { activo: false }, ['id_espacio', 'fecha_creacion']);
    }

    registrar(
      SHEETS.ESPACIOS,
      espacio.id_espacio,
      'descartado',
      'Espacio personal/huérfano ("' + (espacio.nombre || '') + '") desactivado (los espacios compartidos válidos son ' + MIG_ESPACIOS_VALIDOS.join(' y ') + ').'
    );
  });
}

/**
 * Transacciones/Deudas/Presupuestos: descarta filas corruptas (esFilaCorrupta)
 * y reasigna id_espacio en las válidas hacia `espacioDestino`. Una fila
 * corrupta NO se reasigna de espacio — se descarta directamente, da igual de
 * dónde colgaba. Una fila que ya está en CUALQUIERA de los dos espacios
 * válidos (Familia o Telcom) se deja tal cual: no se fuerza todo al destino
 * configurado, solo lo que colgaba de un espacio inválido/huérfano.
 */
function migProcesarEntidadSync(config, dryRun, espacioDestino, registrar) {
  var sheet = getSheet(config.hoja);
  var filas = getAllData(sheet);

  filas.forEach(function (row) {
    var id = row[config.idCampo];
    if (!id) return; // fila en blanco u otra anomalía de la hoja: no tocar.
    if (row.eliminado === true) return; // ya descartada antes (esta migración u otra vía).

    if (esFilaCorrupta(row, config.camposNum)) {
      var camposMalos = config.camposNum
        .filter(function (campo) { return esFilaCorrupta(row, [campo]); })
        .map(function (campo) { return campo + '=' + JSON.stringify(row[campo]); })
        .join(', ');

      if (!dryRun) {
        var filaCorrupta = buscarPorId(sheet, config.idCampo, id);
        if (filaCorrupta) {
          escribirCampos(sheet, filaCorrupta.row, filaCorrupta.headers, { eliminado: true }, [config.idCampo, 'fecha_creacion']);
        }
      }

      registrar(config.hoja, id, 'descartado', 'Fila corrupta (' + camposMalos + ').');
      return;
    }

    if (row.id_espacio && MIG_ESPACIOS_VALIDOS.indexOf(row.id_espacio) === -1) {
      if (!dryRun) {
        var filaValida = buscarPorId(sheet, config.idCampo, id);
        if (filaValida) {
          escribirCampos(sheet, filaValida.row, filaValida.headers, { id_espacio: espacioDestino }, [config.idCampo, 'fecha_creacion']);
        }
      }

      var quien = row.id_usuario ? ' (id_usuario conservado: ' + row.id_usuario + ')' : '';
      registrar(config.hoja, id, 'migrado', 'Reasignado de espacio "' + row.id_espacio + '" a ' + espacioDestino + quien + '.');
    }
    // Si ya está en un espacio válido (Familia o Telcom) y no es corrupta:
    // nada que hacer, no se loguea de nuevo (así la migración es idempotente
    // sin bitácora aparte).
  });
}

/**
 * Cuentas/Categorías/GastosRecurrentes/Etiquetas: reasigna id_espacio hacia
 * `espacioDestino`. Para Categorías, además intenta rellenar `grupo` por
 * nombre (docs/CONTRACT.md § 6-bis) — ver migInferirGrupoCategoria.
 */
function migProcesarEntidadEspacioSimple(config, dryRun, espacioDestino, registrar) {
  var sheet = getSheet(config.hoja);
  var filas = getAllData(sheet);
  var esCategorias = config.hoja === SHEETS.CATEGORIAS;

  filas.forEach(function (row) {
    var id = row[config.idCampo];
    if (!id) return;
    if (row.id_espacio && MIG_ESPACIOS_VALIDOS.indexOf(row.id_espacio) !== -1) return;

    var cambios = { id_espacio: espacioDestino };
    var motivoGrupo = '';

    if (esCategorias && !row.grupo) {
      var grupoInferido = migInferirGrupoCategoria(row.nombre, espacioDestino);
      if (grupoInferido) {
        cambios.grupo = grupoInferido;
        motivoGrupo = ' grupo inferido: "' + grupoInferido + '".';
      }
      // Si no se pudo inferir, `grupo` queda tal cual (vacío) — nunca se
      // inventa un valor (docs/CONTRACT.md § 6-bis).
    }

    if (!dryRun) {
      var fila = buscarPorId(sheet, config.idCampo, id);
      if (fila) escribirCampos(sheet, fila.row, fila.headers, cambios, [config.idCampo]);
    }

    registrar(config.hoja, id, 'migrado', 'Reasignado de espacio "' + row.id_espacio + '" a ' + espacioDestino + '.' + motivoGrupo);
  });
}

/**
 * Infiere `grupo` (docs/CONTRACT.md § 6-bis) para una categoría migrada, por
 * coincidencia de nombre (normalizado: minúsculas, sin tildes, espacios
 * colapsados). Devuelve '' si no se puede inferir con certeza o si el destino
 * es ESP_FAMILIA (que no agrupa) — nunca se adivina.
 */
function migInferirGrupoCategoria(nombre, espacioDestino) {
  if (espacioDestino !== MIG_ESP_TELCOM_ID) return '';
  if (!nombre) return '';

  var normalizado = String(nombre)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos (diacríticos combinados tras NFD)
    .replace(/\s+/g, ' ')
    .trim();

  return MIG_GRUPO_POR_CATEGORIA_TELCOM[normalizado] || '';
}

/** Notificaciones: rellena canal='app' donde 91_setup.js lo dejó en blanco a propósito. */
function migProcesarCanalNotificaciones(dryRun, registrar) {
  var sheet = getSheet(SHEETS.NOTIFICACIONES);
  var filas = getAllData(sheet);

  filas.forEach(function (row) {
    if (!row.id_notificacion) return;
    if (row.canal) return; // ya tiene canal.

    if (!dryRun) {
      var fila = buscarPorId(sheet, 'id_notificacion', row.id_notificacion);
      if (fila) escribirCampos(sheet, fila.row, fila.headers, { canal: 'app' }, ['id_notificacion']);
    }

    registrar(SHEETS.NOTIFICACIONES, row.id_notificacion, 'migrado', "canal asignado por defecto: 'app'.");
  });
}

/** Obtiene (o crea con encabezados) la hoja de auditoría de la migración. */
function migGetLogSheet() {
  var sheet = getSheet('MigracionLog');
  if (obtenerEncabezados(sheet).length === 0) {
    var encabezados = ['fecha', 'entidad', 'id', 'accion', 'motivo'];
    sheet.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Agrega las filas nuevas de `detalle` al final de MigracionLog. No hace nada si `detalle` está vacío. */
function migEscribirLog(detalle) {
  if (!detalle || detalle.length === 0) return;
  var sheet = migGetLogSheet();
  var filas = detalle.map(function (d) { return [d.fecha, d.entidad, d.id, d.accion, d.motivo]; });
  sheet.getRange(sheet.getLastRow() + 1, 1, filas.length, 5).setValues(filas);
}
