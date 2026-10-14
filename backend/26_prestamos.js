/**
 * 26_prestamos.js — Préstamos bancarios (docs/CONTRACT.md § 4-quinquies).
 *
 * Esta hoja guarda solo la cabecera del préstamo (banco, monto, TEA, plazo). Las cuotas son
 * Deudas `debo` con `id_prestamo`, `nro_cuota` y el desglose capital/interés/otros: las crea el
 * cliente por `sincronizar` (funciona sin conexión) a partir del cronograma que el usuario
 * revisó contra el papel del banco. Por eso acá no se calcula ningún cronograma.
 *
 * Como Trabajadores: no sincronizable, escritura solo del propietario, viaja completa en
 * `cambios.prestamos`. Baja lógica con `activo = false`.
 */

var _TIPOS_PRESTAMO = ['prestamo', 'tarjeta', 'leasing', 'otro'];

function prs_preparar(datos, exigirTodos) {
  datos = datos || {};
  if (exigirTodos) {
    var requeridos = datos.modalidad === 'cuota_fija'
      ? ['id_espacio', 'entidad', 'cuota_mensual', 'dia_pago']
      : ['id_espacio', 'entidad', 'monto', 'plazo', 'dia_pago', 'fecha_desembolso'];
    var req = validarRequeridos(datos, requeridos);
    if (!req.valido) return { valido: false, error: req.error, detalle: req.detalle };
  }
  var n = {};
  if (datos.entidad !== undefined) n.entidad = sanearTexto(datos.entidad, 80);
  if (datos.descripcion !== undefined) n.descripcion = sanearTexto(datos.descripcion, 200);
  if (datos.notas !== undefined) n.notas = sanearTexto(datos.notas, 500);
  if (datos.id_cuenta !== undefined) n.id_cuenta = datos.id_cuenta || '';
  if (datos.id_espacio !== undefined) n.id_espacio = datos.id_espacio;
  if (datos.activo !== undefined) n.activo = datos.activo === true || datos.activo === 'true';
  if (datos.modalidad !== undefined) {
    var modV = validarTipo(datos.modalidad || 'cronograma', ['cronograma', 'cuota_fija']);
    if (!modV.valido) return { valido: false, error: modV.error, detalle: 'modalidad inválida.' };
    n.modalidad = modV.valor;
  }
  if (datos.cuota_mensual !== undefined && datos.cuota_mensual !== '') {
    var cuotaV = validarMonto(datos.cuota_mensual);
    if (!cuotaV.valido) return { valido: false, error: cuotaV.error, detalle: 'cuota_mensual: ' + cuotaV.detalle };
    n.cuota_mensual = cuotaV.valor;
  }

  if (datos.tipo !== undefined) {
    var tipoV = validarTipo(datos.tipo, _TIPOS_PRESTAMO);
    if (!tipoV.valido) return { valido: false, error: tipoV.error, detalle: 'tipo de préstamo inválido.' };
    n.tipo = tipoV.valor;
  } else if (exigirTodos) {
    n.tipo = 'prestamo';
  }

  var montos = ['monto', 'tea'];
  for (var i = 0; i < montos.length; i++) {
    if (datos[montos[i]] === undefined) continue;
    var mV = validarMonto(datos[montos[i]]);
    if (!mV.valido) return { valido: false, error: mV.error, detalle: montos[i] + ': ' + mV.detalle };
    n[montos[i]] = mV.valor;
  }

  if (datos.plazo !== undefined) {
    var plazo = parseInt(datos.plazo, 10);
    if (isNaN(plazo) || plazo < 1 || plazo > 600) return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'El plazo va de 1 a 600 meses.' };
    n.plazo = plazo;
  }
  if (datos.dia_pago !== undefined) {
    var dia = parseInt(datos.dia_pago, 10);
    if (isNaN(dia) || dia < 1 || dia > 31) return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'El día de pago va del 1 al 31.' };
    n.dia_pago = dia;
  }
  if (datos.fecha_desembolso !== undefined) {
    var fV = validarFecha(datos.fecha_desembolso);
    if (!fV.valido) return { valido: false, error: fV.error, detalle: fV.detalle };
    n.fecha_desembolso = fV.valor;
  }
  return { valido: true, datos: n };
}

function crearPrestamo(p) {
  var prep = prs_preparar(p, true);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  return withLock(function () {
    // El cliente genera el id para poder crear las cuotas offline con id_prestamo ya fijado.
    // Reintentar con el mismo id no duplica: se devuelve el que ya existe.
    var sheet = getSheet(SHEETS.PRESTAMOS);
    if (p.id_prestamo) {
      var existente = buscarPorId(sheet, 'id_prestamo', p.id_prestamo);
      if (existente) return respuestaExito({ prestamo: existente.datos });
    }
    var ahora = fechaHoraActual();
    var d = prep.datos;
    var obj = {
      id_prestamo: p.id_prestamo || generateId('PRS'),
      id_espacio: d.id_espacio,
      entidad: d.entidad,
      tipo: d.tipo,
      descripcion: d.descripcion || '',
      monto: d.monto || 0,
      tea: d.tea || 0,
      plazo: d.plazo || '',
      dia_pago: d.dia_pago,
      fecha_desembolso: d.fecha_desembolso || '',
      id_cuenta: d.id_cuenta || '',
      activo: true,
      notas: d.notas || '',
      fecha_creacion: ahora,
      fecha_modificacion: ahora,
      modalidad: d.modalidad || 'cronograma',
      cuota_mensual: d.cuota_mensual || '',
      fecha_fin: ''
    };
    anexarFila(sheet, obj);
    if (obj.modalidad === 'cuota_fija') prs_crearObligacion(obj, p.periodo_generado);
    return respuestaExito({ prestamo: obj });
  });
}

function getPrestamos(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');
  return respuestaExito({
    prestamos: getAllData(getSheet(SHEETS.PRESTAMOS)).filter(function (x) { return x.id_espacio === idEspacio; })
  });
}

function actualizarPrestamo(p) {
  var req = validarRequeridos(p, ['id_prestamo']);
  if (!req.valido) return respuestaError(req.error, req.detalle);
  var prep = prs_preparar(p, false);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);
  delete prep.datos.id_espacio;

  var sheet = getSheet(SHEETS.PRESTAMOS);
  var fila = buscarPorId(sheet, 'id_prestamo', p.id_prestamo);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Préstamo no encontrado.');

  return withLock(function () {
    prep.datos.fecha_modificacion = fechaHoraActual();
    escribirCampos(sheet, fila.row, fila.headers, prep.datos, ['id_prestamo', 'id_espacio', 'fecha_creacion']);
    return respuestaExito({ prestamo: buscarPorId(sheet, 'id_prestamo', p.id_prestamo).datos });
  });
}

/**
 * Obligación mensual que genera las cuotas de un préstamo de cuota fija. `periodoGenerado`
 * ('yyyy-MM') es el mes cuya cuota ya creó el cliente: el trigger arranca desde el siguiente.
 */
function prs_crearObligacion(prestamo, periodoGenerado) {
  var oblSheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
  var ya = getAllData(oblSheet).some(function (o) { return o.id_prestamo === prestamo.id_prestamo && !o.eliminado; });
  if (ya) return;
  var cat = getAllData(getSheet(SHEETS.CATEGORIAS)).filter(function (c) {
    return c.id_espacio === prestamo.id_espacio && c.activo && c.nombre === 'Amortización de préstamos';
  })[0];
  var ahora = fechaHoraActual();
  anexarFila(oblSheet, {
    id_obligacion: generateId('OBL'),
    id_espacio: prestamo.id_espacio,
    concepto: prestamo.entidad + (prestamo.descripcion ? ' · ' + prestamo.descripcion : ''),
    id_categoria: cat ? cat.id_categoria : '',
    id_cuenta: prestamo.id_cuenta || '',
    monto_estimado: prestamo.cuota_mensual,
    dia_vencimiento: prestamo.dia_pago,
    ultimo_periodo_generado: periodoGenerado ? "'" + periodoGenerado : '',
    activo: true,
    notas: 'Cuota fija del préstamo ' + prestamo.id_prestamo,
    fecha_creacion: ahora,
    eliminado: false,
    fecha_modificacion: ahora,
    id_trabajador: '',
    id_prestamo: prestamo.id_prestamo
  });
}

/**
 * finalizarPrestamo({ id_prestamo }) — "ese fue el último pago". Cierra el préstamo, deja de
 * generar cuotas y anula (borrado lógico) las cuotas futuras que quedaran abiertas. Lo ya
 * pagado y el historial no se tocan.
 */
function finalizarPrestamo(p) {
  var id = p && p.id_prestamo;
  if (!id) return respuestaError('CAMPO_REQUERIDO', 'falta: id_prestamo');
  var sheet = getSheet(SHEETS.PRESTAMOS);
  var fila = buscarPorId(sheet, 'id_prestamo', id);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Préstamo no encontrado.');

  return withLock(function () {
    var ahora = fechaHoraActual();
    var hoy = ahora.slice(0, 10);
    escribirCampos(sheet, fila.row, fila.headers, { activo: false, fecha_fin: hoy, fecha_modificacion: ahora }, ['id_prestamo']);

    var oblSheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
    getAllData(oblSheet).forEach(function (o) {
      if (o.id_prestamo !== id || o.eliminado) return;
      var f = buscarPorId(oblSheet, 'id_obligacion', o.id_obligacion);
      escribirCampos(oblSheet, f.row, f.headers, { activo: false, fecha_modificacion: ahora }, ['id_obligacion']);
    });

    var deudasSheet = getSheet(SHEETS.DEUDAS);
    var anuladas = 0;
    getAllData(deudasSheet).forEach(function (d) {
      if (d.id_prestamo !== id || d.eliminado || d.estado === 'pagada') return;
      if (String(d.fecha_vencimiento) <= hoy) return; // vencidas sin pagar: quedan, alguien tiene que verlas
      var f = buscarPorId(deudasSheet, 'id_deuda', d.id_deuda);
      escribirCampos(deudasSheet, f.row, f.headers, { eliminado: true, rev: (parseInt(d.rev, 10) || 1) + 1, fecha_modificacion: ahora }, ['id_deuda']);
      anuladas++;
    });

    return respuestaExito({ prestamo: buscarPorId(sheet, 'id_prestamo', id).datos, cuotas_anuladas: anuladas });
  });
}

function idEspacioDePrestamo(idPrestamo) {
  var fila = buscarPorId(getSheet(SHEETS.PRESTAMOS), 'id_prestamo', idPrestamo);
  return fila ? fila.datos.id_espacio : null;
}
