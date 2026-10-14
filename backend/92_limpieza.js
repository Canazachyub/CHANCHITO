/**
 * 92_limpieza.js — limpiarDatosDePrueba (docs/CONTRACT.md § 9).
 *
 * Deja el libro listo para empezar en real: apaga todo lo que quedó de los espacios personales
 * del sistema viejo (ESP_xxxxxxxx), de usuarios de prueba y las filas corruptas (#NUM!).
 *
 * Nunca borra filas: marca `eliminado = true` en las entidades que lo tienen y `activo = false`
 * en el resto. Así la limpieza es reversible a mano y queda auditable en la propia hoja.
 *
 * `dry_run` es true por defecto: devuelve qué haría sin escribir nada. Solo con dry_run=false
 * explícito aplica los cambios. Solo propietario (guardia en el router).
 */

var LIMP_ESPACIOS_VALIDOS = ['ESP_FAMILIA', 'ESP_TELCOM'];
var LIMP_EMAILS_PRUEBA = ['testclaude@test.com'];

/**
 * Recorre una hoja una sola vez y aplica `cambiosDe(fila)` a las que lo pidan (devuelve un
 * objeto de campos o null). Escribe fila por fila solo las afectadas: reescribir el rango
 * entero convertiría en valores cualquier fórmula que hubiera en filas que no se tocan.
 */
function limp_procesarHoja(nombreHoja, cambiosDe, dryRun, idCampo) {
  var sheet = getSheet(nombreHoja);
  var valores = sheet.getDataRange().getValues();
  if (valores.length < 2) return { hoja: nombreHoja, afectadas: 0, ids: [] };
  var headers = valores[0].map(String);
  var afectadas = [];

  for (var r = 1; r < valores.length; r++) {
    var fila = {};
    headers.forEach(function (h, c) { fila[h] = valores[r][c]; });
    var cambios = cambiosDe(fila);
    if (!cambios) continue;
    afectadas.push(fila[idCampo] || ('fila ' + (r + 1)));
    if (dryRun) continue;

    var nueva = valores[r].slice();
    Object.keys(cambios).forEach(function (campo) {
      var c = headers.indexOf(campo);
      if (c !== -1) nueva[c] = cambios[campo];
    });
    sheet.getRange(r + 1, 1, 1, nueva.length).setValues([nueva]);
  }
  return { hoja: nombreHoja, afectadas: afectadas.length, ids: afectadas.slice(0, 30) };
}

function limp_espacioInvalido(fila) {
  return LIMP_ESPACIOS_VALIDOS.indexOf(String(fila.id_espacio)) === -1;
}

function limp_esCorrupta(fila, camposNum) {
  return camposNum.some(function (campo) {
    var v = fila[campo];
    return v === '' ? false : esFilaCorrupta(fila, [campo]);
  });
}

function limpiarDatosDePrueba(p) {
  var datos = p || {};
  var dryRun = !(datos.dry_run === false || datos.dry_run === 'false');
  var emailsPrueba = (datos.desactivar_emails || LIMP_EMAILS_PRUEBA).map(function (e) { return String(e).toLowerCase(); });

  var ejecutar = function () {
    var ahora = fechaHoraActual();
    var resultados = [];
    var baja = function (fila) { return { eliminado: true, rev: (parseInt(fila.rev, 10) || 1) + 1, fecha_modificacion: ahora }; };

    // Entidades sincronizables: eliminado + rev+1 + fecha_modificacion, así los clientes se enteran.
    var sincronizables = [
      { hoja: SHEETS.TRANSACCIONES, id: 'id_transaccion', num: ['monto'] },
      { hoja: SHEETS.DEUDAS, id: 'id_deuda', num: ['monto_original', 'monto_pendiente'] },
      { hoja: SHEETS.PRESUPUESTOS, id: 'id_presupuesto', num: ['monto_limite'] }
    ];
    sincronizables.forEach(function (cfg) {
      resultados.push(limp_procesarHoja(cfg.hoja, function (fila) {
        if (fila.eliminado === true) return null;
        return limp_espacioInvalido(fila) || limp_esCorrupta(fila, cfg.num) ? baja(fila) : null;
      }, dryRun, cfg.id));
    });

    // Con borrado lógico propio.
    [{ hoja: SHEETS.OBLIGACIONES_MENSUALES, id: 'id_obligacion' }, { hoja: SHEETS.SOLICITUDES_DINERO, id: 'id_solicitud' }].forEach(function (cfg) {
      resultados.push(limp_procesarHoja(cfg.hoja, function (fila) {
        return fila.eliminado !== true && limp_espacioInvalido(fila) ? { eliminado: true, fecha_modificacion: ahora } : null;
      }, dryRun, cfg.id));
    });

    // Tablas de referencia: activo=false.
    [
      { hoja: SHEETS.CUENTAS, id: 'id_cuenta' },
      { hoja: SHEETS.CATEGORIAS, id: 'id_categoria' },
      { hoja: SHEETS.GASTOS_RECURRENTES, id: 'id_gasto_recurrente' },
      { hoja: SHEETS.ESPACIOS, id: 'id_espacio' }
    ].forEach(function (cfg) {
      resultados.push(limp_procesarHoja(cfg.hoja, function (fila) {
        return fila.activo !== false && limp_espacioInvalido(fila) ? { activo: false } : null;
      }, dryRun, cfg.id));
    });

    // Usuarios de prueba.
    var idsPrueba = [];
    resultados.push(limp_procesarHoja(SHEETS.USUARIOS, function (fila) {
      if (fila.activo === false) return null;
      if (emailsPrueba.indexOf(String(fila.email).toLowerCase()) === -1) return null;
      idsPrueba.push(fila.id_usuario);
      return { activo: false };
    }, dryRun, 'id_usuario'));

    // Membresías: de espacios viejos, de usuarios de prueba o de usuarios que ya no existen.
    var existentes = getAllData(getSheet(SHEETS.USUARIOS)).map(function (u) { return u.id_usuario; });
    resultados.push(limp_procesarHoja(SHEETS.MIEMBROS_ESPACIO, function (fila) {
      if (fila.activo === false) return null;
      var huerfano = existentes.indexOf(fila.id_usuario) === -1;
      return limp_espacioInvalido(fila) || huerfano || idsPrueba.indexOf(fila.id_usuario) !== -1 ? { activo: false } : null;
    }, dryRun, 'id_miembro'));

    return respuestaExito({
      dry_run: dryRun,
      resumen: resultados.map(function (x) { return x.hoja + ': ' + x.afectadas; }),
      detalle: resultados
    });
  };

  return dryRun ? ejecutar() : withLock(ejecutar);
}

/**
 * Atajo para correr desde el editor de Apps Script (botón Ejecutar), sin pasar por la app:
 * primero `limpiezaPrueba` para ver qué haría; después `limpiezaAplicar`.
 */
function limpiezaPrueba() {
  var r = limpiarDatosDePrueba({ dry_run: true });
  Logger.log(JSON.stringify(r.data, null, 2));
  return r;
}

function limpiezaAplicar() {
  var r = limpiarDatosDePrueba({ dry_run: false });
  Logger.log(JSON.stringify(r.data, null, 2));
  return r;
}
