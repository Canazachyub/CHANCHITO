/**
 * 12_cuentas.js — cuentas del espacio compartido (efectivo, banco, tarjeta...).
 */

function crearCuenta(datos) {
  var validacion = validarRequeridos(datos, ['nombre', 'id_espacio']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  var saldoValidacion = validarMonto(datos.saldo_inicial === undefined ? 0 : datos.saldo_inicial);
  if (!saldoValidacion.valido) return respuestaError(saldoValidacion.error, saldoValidacion.detalle);

  return withLock(function () {
    var sheet = getSheet(SHEETS.CUENTAS);
    var id = generateId('CTA');

    anexarFila(sheet, {
      id_cuenta: id,
      id_espacio: datos.id_espacio,
      nombre: sanearTexto(datos.nombre, 100),
      tipo: sanearTexto(datos.tipo, 30) || 'efectivo',
      saldo_inicial: saldoValidacion.valor,
      moneda: sanearTexto(datos.moneda, 10) || 'PEN',
      color: sanearTexto(datos.color, 20) || '#0A84FF',
      icono: sanearTexto(datos.icono, 10) || '💰',
      incluir_total: datos.incluir_total !== false,
      orden: parseInt(datos.orden, 10) || 0,
      activo: true,
      fecha_creacion: fechaHoraActual()
    });

    return respuestaExito({ id_cuenta: id });
  });
}

function getCuentas(idEspacio) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.CUENTAS);
  var cuentas = getAllData(sheet).filter(function (c) { return c.id_espacio === idEspacio && c.activo; });

  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES));

  cuentas.forEach(function (cuenta) {
    var propias = transacciones.filter(function (t) { return t.id_cuenta === cuenta.id_cuenta && !t.eliminado; });
    cuenta.balance = calcularBalance(propias, cuenta.saldo_inicial);
  });

  cuentas.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });

  return respuestaExito({ cuentas: cuentas });
}

function getCuenta(idCuenta) {
  var sheet = getSheet(SHEETS.CUENTAS);
  var fila = buscarPorId(sheet, 'id_cuenta', idCuenta);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Cuenta no encontrada.');
  return respuestaExito({ cuenta: fila.datos });
}

function getBalanceCuenta(idCuenta) {
  var sheet = getSheet(SHEETS.CUENTAS);
  var fila = buscarPorId(sheet, 'id_cuenta', idCuenta);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Cuenta no encontrada.');

  var transacciones = getAllData(getSheet(SHEETS.TRANSACCIONES)).filter(function (t) {
    return t.id_cuenta === idCuenta && !t.eliminado;
  });
  var balance = calcularBalance(transacciones, fila.datos.saldo_inicial);

  var transferencias = getAllData(getSheet(SHEETS.TRANSFERENCIAS));
  transferencias.forEach(function (t) {
    if (t.cuenta_origen === idCuenta) balance -= parseFloat(t.monto) || 0;
    if (t.cuenta_destino === idCuenta) balance += parseFloat(t.monto) || 0;
  });

  return respuestaExito({ balance: balance });
}

function actualizarCuenta(datos) {
  var validacion = validarRequeridos(datos, ['id_cuenta']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  if (datos.saldo_inicial !== undefined) {
    var saldoValidacion = validarMonto(datos.saldo_inicial);
    if (!saldoValidacion.valido) return respuestaError(saldoValidacion.error, saldoValidacion.detalle);
    datos.saldo_inicial = saldoValidacion.valor;
  }

  var sheet = getSheet(SHEETS.CUENTAS);
  var fila = buscarPorId(sheet, 'id_cuenta', datos.id_cuenta);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Cuenta no encontrada.');

  return withLock(function () {
    escribirCampos(sheet, fila.row, fila.headers, datos, ['id_cuenta', 'fecha_creacion']);
    return respuestaExito({ id_cuenta: datos.id_cuenta });
  });
}

/** Borrado lógico (activo=false). Cuentas no es una entidad de § 4 pero se evita deleteRow igualmente. */
function eliminarCuenta(idCuenta) {
  var sheet = getSheet(SHEETS.CUENTAS);
  var fila = buscarPorId(sheet, 'id_cuenta', idCuenta);
  if (!fila) return respuestaError('NO_ENCONTRADO', 'Cuenta no encontrada.');

  return withLock(function () {
    sheet.getRange(fila.row, fila.headers.indexOf('activo') + 1).setValue(false);
    return respuestaExito({ id_cuenta: idCuenta });
  });
}

/**
 * idEspacioDeCuenta(idCuenta) → id_espacio de la cuenta, o null si no existe.
 * Uso interno del router (01_router.js) para resolver la guardia de
 * pertenencia en acciones que reciben id_cuenta en vez de id_espacio directo.
 */
function idEspacioDeCuenta(idCuenta) {
  var fila = buscarPorId(getSheet(SHEETS.CUENTAS), 'id_cuenta', idCuenta);
  return fila ? fila.datos.id_espacio : null;
}

/** Uso interno desde 91_setup.js. */
function crearCuentasPorDefectoInterno(idEspacio) {
  var sheet = getSheet(SHEETS.CUENTAS);
  var existentes = getAllData(sheet).filter(function (c) { return c.id_espacio === idEspacio; });

  CUENTAS_POR_DEFECTO.forEach(function (c, i) {
    var yaExiste = existentes.some(function (e) { return e.nombre === c.nombre; });
    if (yaExiste) return;

    anexarFila(sheet, {
      id_cuenta: generateId('CTA'),
      id_espacio: idEspacio,
      nombre: c.nombre,
      tipo: c.tipo,
      saldo_inicial: 0,
      moneda: 'PEN',
      color: c.color,
      icono: c.icono,
      incluir_total: true,
      orden: i,
      activo: true,
      fecha_creacion: fechaHoraActual()
    });
  });
}
