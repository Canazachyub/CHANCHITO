/**
 * 24_obligaciones.js — Obligaciones mensuales (docs/CONTRACT.md § 4-ter).
 *
 * Cuentas previsibles (planilla, EsSalud, CTS, alquiler, seguros...) que el
 * propietario define una vez y el sistema materializa como `Deuda` cada mes,
 * solo. `generarObligacionesDelMes()` es idempotente por diseño: se apoya en
 * `ultimo_periodo_generado` ('yyyy-MM') para no duplicar si corre diez veces
 * el mismo día — la llama el trigger diario (backend/50_triggers.js) y
 * también es invocable a mano.
 *
 * No es entidad sincronizable: sin rev, no entra en `sincronizar` (§ 2).
 *
 * Prefijo `obl` en todo lo interno para no chocar con otros dominios del
 * scope global único de Apps Script.
 *
 * Dependencias externas verificadas contra el código real ya presente en
 * /backend:
 *   - 00_config.js: SHEETS, ESQUEMA_COLUMNAS.
 *   - 02_util.js: getSheet, getAllData, buscarPorId, escribirCampos,
 *     generateId, fechaHoraActual, withLock, respuestaExito, respuestaError,
 *     reportarSentry.
 *   - lib_validacion.js: validarMonto, validarRequeridos, sanearTexto.
 *   - 16_deudas.js: crearDeudaInterna(datosNormalizados, idForzado) — variante
 *     SIN lock propio (mismo patrón que crearTransaccionInterna en
 *     14_transacciones.js), se usa desde dentro de este archivo porque
 *     generarObligacionesDelMes ya corre bajo su propio withLock().
 *
 * `activo`/`eliminado`: dos flags con roles distintos, igual que en
 * Presupuestos (18_presupuestos.js). `activo=false` es lo que lee
 * generarObligacionesDelMes para dejar de materializar (§ 4-ter: "Dar de
 * baja la obligación (activo=false) deja intactas las deudas ya
 * generadas"). `eliminado=true` es el borrado lógico estándar del resto del
 * sistema (nunca deleteRow) que además la saca de getObligaciones().
 * eliminarObligacion() pone ambos a la vez: siempre dejar de generar Y dejar
 * de listar es el comportamiento esperado de un "eliminar".
 */

// ==================== HELPERS INTERNOS ====================

/** Último día del mes `mes` (1-indexado) del año `anio`. `new Date(anio, mes, 0)` cae en el día 0 del mes siguiente = último día de `mes`. */
function obl_ultimoDiaDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

/**
 * Fecha de vencimiento 'yyyy-MM-dd' para `mes`/`anio` dado un día de plantilla.
 *
 * Delega en `resolverFechaVencimientoMensual` (lib_calculos.js), que es la versión
 * pura cubierta por tests/obligaciones_mensuales.js (febrero, bisiesto, meses de 30).
 * Antes había acá una copia equivalente: dos implementaciones de la misma regla, con
 * los tests apuntando a la que NO corre en producción.
 */
function obl_fechaVencimientoDelMes(anio, mes, diaVencimiento) {
  return resolverFechaVencimientoMensual(diaVencimiento, mes, anio);
}

/** 'yyyy-MM'. Misma razón que arriba: la versión probada vive en lib_obligaciones.js. */
function obl_periodo(fecha) {
  return periodoActual(fecha);
}

function obl_crearFila(datos) {
  var sheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
  var id = generateId('OBL');
  var ahora = fechaHoraActual();

  var obj = {
    id_obligacion: id,
    id_espacio: datos.id_espacio,
    concepto: sanearTexto(datos.concepto, 200),
    id_categoria: datos.id_categoria,
    id_cuenta: datos.id_cuenta,
    monto_estimado: datos.monto_estimado,
    dia_vencimiento: datos.dia_vencimiento,
    ultimo_periodo_generado: '',
    activo: true,
    notas: sanearTexto(datos.notas, 500),
    fecha_creacion: ahora,
    eliminado: false,
    fecha_modificacion: ahora,
    // Planilla de una persona concreta (§ 4-quater): la deuda generada hereda el trabajador.
    id_trabajador: datos.id_trabajador || ''
  };

  anexarFila(sheet, obj);

  return obj;
}

// ==================== ENDPOINTS (nombres exactos — docs/CONTRACT.md § 3) ====================
// Las tres de escritura (crear/actualizar/eliminar) son solo para el
// propietario; ese guardia lo aplica el router (auth: 'propietario'), igual
// que en crearUsuario/desactivarUsuario/actualizarEspacio — estas funciones
// no reciben `u` y no repiten la verificación de rol.

function crearObligacion(p) {
  var datos = p || {};

  var req = validarRequeridos(datos, ['id_espacio', 'concepto', 'id_categoria', 'id_cuenta', 'monto_estimado', 'dia_vencimiento']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var montoV = validarMonto(datos.monto_estimado);
  if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);

  var dia = parseInt(datos.dia_vencimiento, 10);
  if (isNaN(dia) || dia < 1 || dia > 31) {
    return respuestaError('CAMPO_REQUERIDO', 'El día de vencimiento debe estar entre 1 y 31.');
  }

  return withLock(function () {
    var creada = obl_crearFila({
      id_espacio: datos.id_espacio,
      concepto: datos.concepto,
      id_categoria: datos.id_categoria,
      id_cuenta: datos.id_cuenta,
      monto_estimado: montoV.valor,
      dia_vencimiento: dia,
      notas: datos.notas,
      id_trabajador: datos.id_trabajador
    });
    return respuestaExito({ id_obligacion: creada.id_obligacion, obligacion: creada });
  });
}

/**
 * getObligaciones(p) — filtrable por p.id_espacio (opcional) y p.activo
 * (opcional; sin filtro devuelve activas e inactivas, para que
 * Administración pueda reactivarlas vía actualizarObligacion). Siempre
 * excluye eliminado=true.
 */
function getObligaciones(p) {
  var datos = p || {};
  var sheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
  var obligaciones = getAllData(sheet).filter(function (o) { return !o.eliminado; });

  if (datos.id_espacio) obligaciones = obligaciones.filter(function (o) { return o.id_espacio === datos.id_espacio; });
  if (datos.activo !== undefined && datos.activo !== '') {
    var activoBool = datos.activo === true || datos.activo === 'true';
    obligaciones = obligaciones.filter(function (o) { return !!o.activo === activoBool; });
  }

  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS));
  var cuentas = getAllData(getSheet(SHEETS.CUENTAS));
  // No llamarla `periodoActual`: sombrearía la función global de lib_obligaciones.js.
  var periodoDelMes = obl_periodo(new Date());

  obligaciones = obligaciones.map(function (o) {
    var categoria = categorias.filter(function (c) { return c.id_categoria === o.id_categoria; })[0];
    var cuenta = cuentas.filter(function (c) { return c.id_cuenta === o.id_cuenta; })[0];
    var enriquecida = {};
    for (var k in o) enriquecida[k] = o[k];
    enriquecida.categoria_nombre = categoria ? categoria.nombre : null;
    enriquecida.categoria_icono = categoria ? categoria.icono : null;
    enriquecida.cuenta_nombre = cuenta ? cuenta.nombre : null;
    enriquecida.generada_este_mes = o.ultimo_periodo_generado === periodoDelMes;
    return enriquecida;
  });

  return respuestaExito({ obligaciones: obligaciones });
}

function actualizarObligacion(p) {
  var datos = p || {};

  var req = validarRequeridos(datos, ['id_obligacion']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var sheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
  var fila = buscarPorId(sheet, 'id_obligacion', datos.id_obligacion);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Obligación no encontrada.');

  var paraEscribir = {};

  if (datos.concepto !== undefined) paraEscribir.concepto = sanearTexto(datos.concepto, 200);
  if (datos.id_categoria !== undefined) paraEscribir.id_categoria = datos.id_categoria;
  if (datos.id_cuenta !== undefined) paraEscribir.id_cuenta = datos.id_cuenta;
  if (datos.notas !== undefined) paraEscribir.notas = sanearTexto(datos.notas, 500);
  if (datos.id_trabajador !== undefined) paraEscribir.id_trabajador = datos.id_trabajador || '';
  if (datos.activo !== undefined) paraEscribir.activo = datos.activo === true || datos.activo === 'true';

  if (datos.monto_estimado !== undefined) {
    var montoV = validarMonto(datos.monto_estimado);
    if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);
    paraEscribir.monto_estimado = montoV.valor;
  }

  if (datos.dia_vencimiento !== undefined) {
    var dia = parseInt(datos.dia_vencimiento, 10);
    if (isNaN(dia) || dia < 1 || dia > 31) {
      return respuestaError('CAMPO_REQUERIDO', 'El día de vencimiento debe estar entre 1 y 31.');
    }
    paraEscribir.dia_vencimiento = dia;
  }

  return withLock(function () {
    paraEscribir.fecha_modificacion = fechaHoraActual();
    // ultimo_periodo_generado es manejado exclusivamente por
    // generarObligacionesDelMes: nunca se toca desde una edición manual.
    escribirCampos(sheet, fila.row, fila.headers, paraEscribir, ['id_obligacion', 'fecha_creacion', 'ultimo_periodo_generado', 'eliminado']);
    var actualizada = buscarPorId(sheet, 'id_obligacion', datos.id_obligacion).datos;
    return respuestaExito({ obligacion: actualizada });
  });
}

/** Baja lógica: activo=false (deja de generar) + eliminado=true (deja de listarse). Las deudas ya generadas quedan intactas. */
function eliminarObligacion(p) {
  var datos = p || {};
  var idObligacion = datos.id_obligacion;
  if (!idObligacion) return respuestaError('CAMPO_REQUERIDO', 'falta: id_obligacion');

  var sheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
  var fila = buscarPorId(sheet, 'id_obligacion', idObligacion);
  if (!fila || fila.datos.eliminado) return respuestaError('NO_ENCONTRADO', 'Obligación no encontrada.');

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, {
      activo: false,
      eliminado: true,
      fecha_modificacion: fechaHoraActual()
    }, ['id_obligacion']);
    return respuestaExito({ id_obligacion: idObligacion });
  });
}

/**
 * generarObligacionesDelMes() — la llama el trigger diario
 * (backend/50_triggers.js) y también es invocable a mano vía POST. Por cada
 * obligación activa cuyo ultimo_periodo_generado no sea el mes en curso,
 * crea la Deuda correspondiente y actualiza el período. Todo el lote corre
 * bajo un único withLock(), igual que el lote de `sincronizar` (§ 4): así
 * dos disparos casi simultáneos del trigger no generan la misma deuda dos
 * veces (el segundo, al tomar el lock después, ve ultimo_periodo_generado ya
 * actualizado por el primero).
 *
 * Errores por obligación individual (monto corrupto, etc.) se reportan a
 * Sentry y se saltan esa obligación sin abortar el resto del lote — mismo
 * criterio que tgTriggerGastosRecurrentes en 50_triggers.js.
 */
function generarObligacionesDelMes() {
  try {
    return withLock(function () {
      var sheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
      var obligaciones = getAllData(sheet).filter(function (o) { return o.activo && !o.eliminado; });

      var hoy = new Date();
      // Ojo con el nombre: `periodoActual` es una función global de lib_obligaciones.js.
      // Una variable local con ese mismo nombre la sombrearía dentro de esta función.
      var periodoDelMes = obl_periodo(hoy);
      var anioActual = hoy.getFullYear();
      var mesActual = hoy.getMonth() + 1;

      var generadas = [];

      obligaciones.forEach(function (o) {
        // Idempotencia del trigger diario, con la versión pura que cubren los tests.
        if (!debeGenerarPeriodo(o.ultimo_periodo_generado, periodoDelMes)) return;

        try {
          var montoV = validarMonto(o.monto_estimado);
          if (!montoV.valido) {
            reportarSentry(new Error('Obligación con monto inválido: ' + o.id_obligacion), { origen: 'generarObligacionesDelMes' });
            return;
          }

          var fechaVencimiento = obl_fechaVencimientoDelMes(anioActual, mesActual, o.dia_vencimiento);

          // Cuota de un préstamo de cuota fija: la deuda va enlazada al préstamo y numerada.
          var nroCuota = '';
          if (o.id_prestamo) {
            nroCuota = getAllData(getSheet(SHEETS.DEUDAS)).filter(function (d) { return d.id_prestamo === o.id_prestamo && !d.eliminado; }).length + 1;
          }

          var deuda = crearDeudaInterna({
            id_espacio: o.id_espacio,
            id_usuario: '',
            id_trabajador: o.id_trabajador || '',
            id_prestamo: o.id_prestamo || '',
            nro_cuota: nroCuota,
            tipo: 'debo',
            persona: o.concepto,
            monto_original: montoV.valor,
            monto_pendiente: montoV.valor,
            descripcion: 'Obligación mensual: ' + o.concepto,
            fecha_vencimiento: fechaVencimiento,
            origen: 'app',
            notas: 'Generada automáticamente desde ObligacionesMensuales (' + o.id_obligacion + ')'
          }, null);

          var filaObligacion = buscarPorId(sheet, 'id_obligacion', o.id_obligacion);
          escribirCampos(sheet, filaObligacion.row, filaObligacion.headers, {
            ultimo_periodo_generado: "'" + periodoDelMes, // apóstrofo: texto, no fecha (normalizarValorCelda)
            fecha_modificacion: fechaHoraActual()
          }, ['id_obligacion', 'fecha_creacion']);

          generadas.push({ id_obligacion: o.id_obligacion, id_deuda: deuda.id_deuda });
        } catch (errUno) {
          reportarSentry(errUno, { origen: 'generarObligacionesDelMes:obligacion', id_obligacion: o.id_obligacion });
        }
      });

      return respuestaExito({ generadas: generadas });
    });
  } catch (err) {
    reportarSentry(err, { origen: 'generarObligacionesDelMes' });
    return respuestaError('ERROR_INTERNO', err && err.message ? err.message : String(err));
  }
}
