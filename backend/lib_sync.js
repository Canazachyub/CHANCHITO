/**
 * lib_sync.js — PURO. Resolución de rev/conflicto para el endpoint `sincronizar`
 * (docs/CONTRACT.md § 4). No toca Sheets: recibe la fila actual (o null).
 * Firmas exactas — docs/CONTRACT.md § "Firmas obligatorias de la lógica pura".
 */

/**
 * resolverOperacion(op, filaActual) → { estado: 'aplicado'|'conflicto'|'rechazado', ... }
 *
 * - crear:   si ya existe una fila con ese id → conflicto (alguien más lo creó).
 *            si no existe → aplicado, rev = siguienteRev(0) = 1.
 * - editar/eliminar: si no existe la fila → rechazado NO_ENCONTRADO.
 *            si rev_base !== rev actual → conflicto (no se sobrescribe).
 *            si coincide → aplicado, rev = siguienteRev(rev actual).
 */
function resolverOperacion(op, filaActual) {
  if (!op || !op.tipo) {
    return { estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'Falta el tipo de operación.' };
  }

  if (op.tipo === 'crear') {
    if (filaActual) {
      return {
        estado: 'conflicto',
        id: op.id,
        version_servidor: filaActual,
        version_cliente: op.datos
      };
    }
    return { estado: 'aplicado', id: op.id, rev: siguienteRev(0) };
  }

  if (op.tipo === 'editar' || op.tipo === 'eliminar') {
    if (!filaActual) {
      return { estado: 'rechazado', error: 'NO_ENCONTRADO', detalle: 'El registro ' + op.id + ' no existe.' };
    }

    var revActual = parseInt(filaActual.rev, 10);
    if (isNaN(revActual)) revActual = 0;

    var revBase = (op.rev_base === null || op.rev_base === undefined) ? null : parseInt(op.rev_base, 10);

    if (revBase !== revActual) {
      return {
        estado: 'conflicto',
        id: op.id,
        version_servidor: filaActual,
        version_cliente: op.datos
      };
    }

    return { estado: 'aplicado', id: op.id, rev: siguienteRev(revActual) };
  }

  return { estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'Tipo de operación desconocido: ' + op.tipo };
}

/**
 * siguienteRev(revActual) → entero. Empieza en 1, sube de a uno.
 */
function siguienteRev(revActual) {
  var rev = parseInt(revActual, 10);
  if (isNaN(rev) || rev < 1) return 1;
  return rev + 1;
}

/**
 * resolverPagoDeuda(op, deudaActual, montoValidado) → { estado, ... }
 * Variante de resolverOperacion para la entidad `pago_deuda` (docs/CONTRACT.md
 * § 4, "Entidad pago_deuda"). PURA: no toca Sheets ni PagosDeuda, solo decide
 * si el pago se puede aplicar contra la DEUDA y calcula el resultado numérico.
 *
 * `montoValidado` ya pasó por validarMonto() en el llamador (formato: NaN,
 * negativo, '#NUM!', etc.) — igual que resolverOperacion, esta función no
 * valida formato de datos, solo la regla de negocio propia de pago_deuda:
 * el monto no puede superar `monto_pendiente`, y el `rev_base` se compara
 * contra el `rev` de la deuda (no existe un "rev" propio del pago).
 */
function resolverPagoDeuda(op, deudaActual, montoValidado) {
  if (!op) {
    return { estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'Falta la operación de pago.' };
  }

  if (!deudaActual || deudaActual.eliminado) {
    return { estado: 'rechazado', error: 'NO_ENCONTRADO', detalle: 'La deuda no existe.' };
  }

  var revActual = parseInt(deudaActual.rev, 10);
  if (isNaN(revActual)) revActual = 0;

  var revBase = (op.rev_base === null || op.rev_base === undefined) ? null : parseInt(op.rev_base, 10);

  if (revBase !== revActual) {
    return {
      estado: 'conflicto',
      id: op.id,
      version_servidor: deudaActual,
      version_cliente: op.datos
    };
  }

  var pendienteActual = parseFloat(deudaActual.monto_pendiente) || 0;
  var monto = parseFloat(montoValidado);

  if (isNaN(monto) || monto <= 0) {
    return { estado: 'rechazado', error: 'MONTO_INVALIDO', detalle: 'El monto del pago no es válido.' };
  }

  if (monto > pendienteActual) {
    return {
      estado: 'rechazado',
      error: 'MONTO_INVALIDO',
      detalle: 'El monto del pago (' + monto + ') supera el saldo pendiente (' + pendienteActual + ').'
    };
  }

  var nuevoPendiente = Math.round((pendienteActual - monto) * 100) / 100;
  var nuevoEstado = nuevoPendiente <= 0 ? 'pagada' : deudaActual.estado;

  return {
    estado: 'aplicado',
    id: op.id,
    id_deuda: deudaActual.id_deuda,
    monto: monto,
    monto_pendiente: nuevoPendiente,
    estado_deuda: nuevoEstado,
    rev: siguienteRev(revActual)
  };
}

/**
 * construirIndiceOperaciones(filas) → { [op_id]: resultadoObj }
 * PURA. Arma en memoria el índice de idempotencia a partir de las filas ya
 * leídas de la hoja `OperacionesAplicadas` (docs/CONTRACT.md § 4, "Idempotencia
 * de op_id — persistente, no en cache"): se lee la hoja UNA vez al empezar el
 * lote de `sincronizar` y se consulta este índice en memoria por cada
 * operación, en vez de volver a leer la hoja entera por cada una.
 * Filas con `resultado` corrupto (no-JSON) se ignoran: mejor recalcular esa
 * operación que reventar el lote entero por una fila dañada.
 */
function construirIndiceOperaciones(filas) {
  var indice = {};
  (filas || []).forEach(function (f) {
    if (!f || !f.op_id) return;
    var resultado = null;
    try { resultado = JSON.parse(f.resultado); } catch (error) { resultado = null; }
    if (resultado) indice[f.op_id] = resultado;
  });
  return indice;
}

/**
 * buscarOperacionAplicada(indice, opId) → resultado guardado, o null si no está.
 * PURA. Simple lookup, separado en función propia para dejar explícito el
 * contrato de lectura del índice de idempotencia.
 */
function buscarOperacionAplicada(indice, opId) {
  if (!indice || !opId) return null;
  return indice[opId] || null;
}

/**
 * filtrarCambiosDesde(filas, desde) → filas con fecha_modificacion > desde.
 * `desde` null → todas las filas.
 */
function filtrarCambiosDesde(filas, desde) {
  if (!desde) return filas || [];
  return (filas || []).filter(function (f) {
    return f && f.fecha_modificacion && String(f.fecha_modificacion) > String(desde);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    resolverOperacion: resolverOperacion,
    siguienteRev: siguienteRev,
    filtrarCambiosDesde: filtrarCambiosDesde,
    resolverPagoDeuda: resolverPagoDeuda,
    construirIndiceOperaciones: construirIndiceOperaciones,
    buscarOperacionAplicada: buscarOperacionAplicada
  };
}
