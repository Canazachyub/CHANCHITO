/**
 * 17_transferencias.js — mueve saldo entre cuentas del espacio compartido.
 * La hoja TransferenciasInterUsuario del legacy se elimina por completo
 * (docs/CONTRACT.md § 0.3 y § 2): ya no hay espacios personales entre los que transferir.
 */

function realizarTransferencia(datos) {
  var validacion = validarRequeridos(datos, ['id_espacio', 'cuenta_origen', 'cuenta_destino', 'monto']);
  if (!validacion.valido) return respuestaError(validacion.error, validacion.detalle);

  if (datos.cuenta_origen === datos.cuenta_destino) {
    return respuestaError('CAMPO_REQUERIDO', 'La cuenta de origen y destino no pueden ser la misma.');
  }

  var montoV = validarMonto(datos.monto);
  if (!montoV.valido) return respuestaError(montoV.error, montoV.detalle);

  var cuentasSheet = getSheet(SHEETS.CUENTAS);
  var origen = buscarPorId(cuentasSheet, 'id_cuenta', datos.cuenta_origen);
  var destino = buscarPorId(cuentasSheet, 'id_cuenta', datos.cuenta_destino);
  if (!origen) return respuestaError('NO_ENCONTRADO', 'La cuenta de origen no existe.');
  if (!destino) return respuestaError('NO_ENCONTRADO', 'La cuenta de destino no existe.');

  var fecha = fechaActual();
  if (datos.fecha) {
    var fechaV = validarFecha(datos.fecha);
    if (!fechaV.valido) return respuestaError(fechaV.error, fechaV.detalle);
    fecha = fechaV.valor;
  }

  return withLock(function () {
    var sheet = getSheet(SHEETS.TRANSFERENCIAS);
    var id = generateId('TRF');

    anexarFila(sheet, {
      id_transferencia: id,
      id_espacio: datos.id_espacio,
      id_usuario: datos.id_usuario || '',
      cuenta_origen: datos.cuenta_origen,
      cuenta_destino: datos.cuenta_destino,
      monto: montoV.valor,
      fecha: fecha,
      nota: sanearTexto(datos.nota, 300)
    });

    return respuestaExito({ id_transferencia: id });
  });
}

function getTransferencias(idEspacio, fechaInicio, fechaFin) {
  if (!idEspacio) return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');

  var sheet = getSheet(SHEETS.TRANSFERENCIAS);
  var transferencias = getAllData(sheet).filter(function (t) { return t.id_espacio === idEspacio; });

  if (fechaInicio) transferencias = transferencias.filter(function (t) { return t.fecha >= fechaInicio; });
  if (fechaFin) transferencias = transferencias.filter(function (t) { return t.fecha <= fechaFin; });

  var cuentas = getAllData(getSheet(SHEETS.CUENTAS));

  transferencias = transferencias.map(function (t) {
    var origen = cuentas.filter(function (c) { return c.id_cuenta === t.cuenta_origen; })[0];
    var destino = cuentas.filter(function (c) { return c.id_cuenta === t.cuenta_destino; })[0];
    var enriquecida = {};
    for (var k in t) enriquecida[k] = t[k];
    enriquecida.cuenta_origen_nombre = origen ? origen.nombre : null;
    enriquecida.cuenta_origen_icono = origen ? origen.icono : null;
    enriquecida.cuenta_destino_nombre = destino ? destino.nombre : null;
    enriquecida.cuenta_destino_icono = destino ? destino.icono : null;
    return enriquecida;
  });

  return respuestaExito({ transferencias: transferencias });
}
