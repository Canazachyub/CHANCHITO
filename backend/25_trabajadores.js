/**
 * 25_trabajadores.js — Trabajadores (docs/CONTRACT.md § 4-quater).
 *
 * A quién se le paga sueldo, honorarios, adelantos, CTS... No son usuarios: la mayoría nunca
 * entra a la app, y meterlos en `Usuarios` los haría aparecer en los botones del bot como
 * "¿de quién es este gasto?". Las transacciones y deudas los referencian por `id_trabajador`.
 *
 * Igual que Obligaciones: no es entidad sincronizable (sin rev), la escritura es solo del
 * propietario y exige conexión. Sí viaja completa en `cambios` de `sincronizar` (como cuentas
 * y categorías) para que la app tenga la lista sin conexión.
 *
 * Baja lógica con `activo = false`: un trabajador que se fue sigue apareciendo en el historial
 * de pagos, por eso no hay `eliminado`.
 */

var _TIPOS_VINCULO = ['planilla', 'honorarios'];

/** Valida y normaliza. `exigirTodos=true` en creación; en edición solo lo que venga. */
function trb_preparar(datos, exigirTodos) {
  datos = datos || {};

  if (exigirTodos) {
    var req = validarRequeridos(datos, ['id_espacio', 'nombre', 'tipo_vinculo']);
    if (!req.valido) return { valido: false, error: req.error, detalle: req.detalle };
  }

  var normalizado = {};

  if (datos.nombre !== undefined) {
    var nombre = sanearTexto(datos.nombre, 120);
    if (!nombre) return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'falta: nombre' };
    normalizado.nombre = nombre;
  }

  if (datos.tipo_vinculo !== undefined) {
    var tipoV = validarTipo(datos.tipo_vinculo, _TIPOS_VINCULO);
    if (!tipoV.valido) return { valido: false, error: tipoV.error, detalle: 'El vínculo debe ser "planilla" o "honorarios".' };
    normalizado.tipo_vinculo = tipoV.valor;
  }

  // Sueldo base vacío es válido (honorarios por servicio, sin monto fijo): se guarda 0.
  if (datos.sueldo_base !== undefined && datos.sueldo_base !== '') {
    var montoV = validarMonto(datos.sueldo_base);
    if (!montoV.valido) return { valido: false, error: montoV.error, detalle: montoV.detalle };
    normalizado.sueldo_base = montoV.valor;
  } else if (exigirTodos) {
    normalizado.sueldo_base = 0;
  }

  // Las fechas de contrato son opcionales ('' = indefinido o sin dato), pero si vienen, válidas:
  // con ellas la app avisa qué contratos hay que renovar.
  var camposFecha = ['fecha_ingreso', 'fecha_fin'];
  for (var i = 0; i < camposFecha.length; i++) {
    var campo = camposFecha[i];
    if (datos[campo] === undefined) continue;
    if (datos[campo] === '') { normalizado[campo] = ''; continue; }
    var fechaV = validarFecha(datos[campo]);
    if (!fechaV.valido) return { valido: false, error: fechaV.error, detalle: campo + ': ' + (fechaV.detalle || 'fecha inválida') };
    normalizado[campo] = fechaV.valor;
  }

  if (datos.documento !== undefined) normalizado.documento = sanearTexto(datos.documento, 20);
  if (datos.cargo !== undefined) normalizado.cargo = sanearTexto(datos.cargo, 80);
  if (datos.proyecto !== undefined) normalizado.proyecto = sanearTexto(datos.proyecto, 80);
  if (datos.pension !== undefined) normalizado.pension = sanearTexto(datos.pension, 40);
  if (datos.notas !== undefined) normalizado.notas = sanearTexto(datos.notas, 500);
  if (datos.id_usuario !== undefined) normalizado.id_usuario = datos.id_usuario || '';
  if (datos.id_espacio !== undefined) normalizado.id_espacio = datos.id_espacio;
  if (datos.activo !== undefined) normalizado.activo = datos.activo === true || datos.activo === 'true';

  return { valido: true, datos: normalizado };
}

// ==================== ENDPOINTS ====================

function crearTrabajador(p) {
  var prep = trb_preparar(p, true);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);

  return withLock(function () {
    var ahora = fechaHoraActual();
    var d = prep.datos;
    var obj = {
      id_trabajador: generateId('TRB'),
      id_espacio: d.id_espacio,
      nombre: d.nombre,
      documento: d.documento || '',
      tipo_vinculo: d.tipo_vinculo,
      cargo: d.cargo || '',
      proyecto: d.proyecto || '',
      sueldo_base: d.sueldo_base,
      pension: d.pension || '',
      fecha_ingreso: d.fecha_ingreso || '',
      fecha_fin: d.fecha_fin || '',
      id_usuario: d.id_usuario || '',
      activo: true,
      notas: d.notas || '',
      fecha_creacion: ahora,
      fecha_modificacion: ahora
    };
    anexarFila(getSheet(SHEETS.TRABAJADORES), obj);
    return respuestaExito({ trabajador: obj });
  });
}

/** Activos e inactivos: la UI necesita los nombres de los que ya se fueron para el historial. */
function getTrabajadores(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');
  var trabajadores = getAllData(getSheet(SHEETS.TRABAJADORES)).filter(function (t) {
    return t.id_espacio === idEspacio;
  });
  return respuestaExito({ trabajadores: trabajadores });
}

function actualizarTrabajador(p) {
  var req = validarRequeridos(p, ['id_trabajador']);
  if (!req.valido) return respuestaError(req.error, req.detalle);

  var prep = trb_preparar(p, false);
  if (!prep.valido) return respuestaError(prep.error, prep.detalle);
  // Mover un trabajador de espacio rompería el historial del espacio de origen.
  delete prep.datos.id_espacio;

  var sheet = getSheet(SHEETS.TRABAJADORES);
  var fila = buscarPorId(sheet, 'id_trabajador', p.id_trabajador);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Trabajador no encontrado.');

  return withLock(function () {
    prep.datos.fecha_modificacion = fechaHoraActual();
    escribirCampos(sheet, fila.row, fila.headers, prep.datos, ['id_trabajador', 'id_espacio', 'fecha_creacion']);
    return respuestaExito({ trabajador: buscarPorId(sheet, 'id_trabajador', p.id_trabajador).datos });
  });
}

/** Baja lógica. Sus pagos y adelantos quedan intactos. */
function darDeBajaTrabajador(p) {
  var idTrabajador = p && p.id_trabajador;
  if (!idTrabajador) return respuestaError('CAMPO_REQUERIDO', 'falta: id_trabajador');

  var sheet = getSheet(SHEETS.TRABAJADORES);
  var fila = buscarPorId(sheet, 'id_trabajador', idTrabajador);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Trabajador no encontrado.');

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, { activo: false, fecha_modificacion: fechaHoraActual() }, ['id_trabajador']);
    return respuestaExito({ trabajador: buscarPorId(sheet, 'id_trabajador', idTrabajador).datos });
  });
}

/** Uso interno del router: guardia de pertenencia para acciones que reciben id_trabajador. */
function idEspacioDeTrabajador(idTrabajador) {
  var fila = buscarPorId(getSheet(SHEETS.TRABAJADORES), 'id_trabajador', idTrabajador);
  return fila ? fila.datos.id_espacio : null;
}
