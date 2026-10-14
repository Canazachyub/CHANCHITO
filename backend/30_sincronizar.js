/**
 * 30_sincronizar.js — endpoint `sincronizar` (docs/CONTRACT.md § 4).
 * Reutiliza las funciones "*Interna" de 14_transacciones.js / 16_deudas.js /
 * 18_presupuestos.js: ellas no validan lock por su cuenta, así que todo el
 * lote corre bajo un único LockService.
 */

// CacheService de Apps Script tiene un TTL máximo real de 21600s (6h). La
// idempotencia de `op_id` YA NO depende de esto: vive de forma persistente en
// la hoja `OperacionesAplicadas` (docs/CONTRACT.md § 4). CacheService queda
// solo como caché de lectura rápida delante de la hoja, para no pagar el
// costo de un lookup en el índice en memoria en el camino más caliente
// (reintentos inmediatos del mismo lote, típico de una reconexión débil).
var _TTL_OPID_SEGUNDOS = 21600;

function _configEntidadSync(nombreEntidad) {
  var info = ENTIDADES_SYNC[nombreEntidad];
  if (!info) return null;

  if (nombreEntidad === 'transaccion') {
    return {
      sheet: getSheet(info.hoja),
      idCampo: info.idCampo,
      validar: prepararTransaccion,
      crearInterna: crearTransaccionInterna,
      actualizarInterna: actualizarTransaccionInterna,
      eliminarInterna: eliminarTransaccionInterna
    };
  }
  if (nombreEntidad === 'deuda') {
    return {
      sheet: getSheet(info.hoja),
      idCampo: info.idCampo,
      validar: prepararDeuda,
      crearInterna: crearDeudaInterna,
      actualizarInterna: actualizarDeudaInterna,
      eliminarInterna: eliminarDeudaInterna
    };
  }
  if (nombreEntidad === 'presupuesto') {
    return {
      sheet: getSheet(info.hoja),
      idCampo: info.idCampo,
      validar: prepararPresupuesto,
      crearInterna: crearPresupuestoInterna,
      actualizarInterna: actualizarPresupuestoInterna,
      eliminarInterna: eliminarPresupuestoInterna
    };
  }
  return null;
}

function _aplicarDecisionSync(op, decision, config, filaActual, datosNormalizados) {
  if (decision.estado === 'aplicado') {
    if (op.tipo === 'crear') {
      config.crearInterna(datosNormalizados, op.id);
    } else if (op.tipo === 'editar') {
      config.actualizarInterna(filaActual, datosNormalizados, decision.rev);
    } else if (op.tipo === 'eliminar') {
      config.eliminarInterna(filaActual, decision.rev);
    }
    return { op_id: op.op_id, estado: 'aplicado', id: op.id, rev: decision.rev };
  }

  if (decision.estado === 'conflicto') {
    return {
      op_id: op.op_id,
      estado: 'conflicto',
      id: op.id,
      version_servidor: decision.version_servidor,
      version_cliente: decision.version_cliente
    };
  }

  return { op_id: op.op_id, estado: 'rechazado', error: decision.error, detalle: decision.detalle };
}

/**
 * Entidad `pago_deuda` del lote (docs/CONTRACT.md § 4, "Entidad pago_deuda").
 * A diferencia de transaccion/deuda/presupuesto, no es un CRUD genérico sobre
 * su propia hoja: valida el monto contra `monto_pendiente` de la DEUDA,
 * inserta la fila en PagosDeuda y actualiza la deuda, reutilizando
 * `_aplicarPagoDeudaInterna` (backend/16_deudas.js) — el mismo núcleo que usa
 * el endpoint suelto `registrarPagoDeuda`, para no duplicar la escritura.
 * `rev_base` se compara contra el `rev` de la deuda, no contra un rev propio
 * del pago (el pago no tiene rev: es un registro de una sola vez).
 *
 * `idEspacio` es el espacio que se está sincronizando (docs/CONTRACT.md § 0.3
 * y § 3): si la deuda pertenece a otro espacio, la operación se rechaza con
 * NO_ES_MIEMBRO en vez de aplicarse.
 */
function _procesarPagoDeudaSync(op, idEspacio) {
  if (!op.id || !op.datos) {
    return { op_id: op.op_id, estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'La operación pago_deuda requiere id y datos.' };
  }
  if (op.tipo !== 'crear') {
    return { op_id: op.op_id, estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'pago_deuda solo admite tipo "crear".' };
  }

  var req = validarRequeridos(op.datos, ['id_deuda', 'monto']);
  if (!req.valido) {
    return { op_id: op.op_id, estado: 'rechazado', error: req.error, detalle: req.detalle };
  }

  var montoV = validarMonto(op.datos.monto);
  if (!montoV.valido) {
    return { op_id: op.op_id, estado: 'rechazado', error: montoV.error, detalle: montoV.detalle };
  }

  var fechaPago = fechaActual();
  if (op.datos.fecha) {
    var fechaV = validarFecha(op.datos.fecha);
    if (!fechaV.valido) {
      return { op_id: op.op_id, estado: 'rechazado', error: fechaV.error, detalle: fechaV.detalle };
    }
    fechaPago = fechaV.valor;
  }

  var deudaSheet = getSheet(SHEETS.DEUDAS);
  var filaDeuda = buscarPorId(deudaSheet, 'id_deuda', op.datos.id_deuda);
  var deudaActual = filaDeuda ? filaDeuda.datos : null;

  if (deudaActual && deudaActual.id_espacio !== idEspacio) {
    return { op_id: op.op_id, estado: 'rechazado', error: 'NO_ES_MIEMBRO', detalle: 'Esa deuda pertenece a otro espacio.' };
  }

  var decision = resolverPagoDeuda(op, deudaActual, montoV.valor);

  if (decision.estado === 'rechazado') {
    return { op_id: op.op_id, estado: 'rechazado', error: decision.error, detalle: decision.detalle };
  }
  if (decision.estado === 'conflicto') {
    return {
      op_id: op.op_id,
      estado: 'conflicto',
      id: op.id,
      version_servidor: decision.version_servidor,
      version_cliente: decision.version_cliente
    };
  }

  var resultado = _aplicarPagoDeudaInterna(
    filaDeuda, decision.monto, fechaPago, op.datos.notas, op.datos.id_transaccion,
    decision.monto_pendiente, decision.estado_deuda, decision.rev, op.id
  );

  // La deuda actualizada viaja en `version_servidor`, el mismo campo que usa el caso
  // 'conflicto' para "fila completa actual" (CONTRACT.md § 4). `rev` es el de la DEUDA:
  // PagosDeuda es un libro de solo-inserción y sus filas no llevan rev propio.
  return {
    op_id: op.op_id,
    estado: 'aplicado',
    id: op.id,
    id_deuda: op.datos.id_deuda,
    rev: decision.rev,
    version_servidor: resultado.deuda
  };
}

/**
 * Decide y aplica una operación del lote, sin considerar todavía la
 * idempotencia de op_id. `idEspacio` es el espacio que se está sincronizando
 * (docs/CONTRACT.md § 0.3 y § 3): el lote y los `cambios` son por espacio.
 * Una operación cuyo registro pertenece a OTRO espacio se rechaza con
 * NO_ES_MIEMBRO en vez de aplicarse; una operación "crear" siempre escribe en
 * el espacio del lote, sin importar lo que traiga `op.datos.id_espacio`
 * (evita que un cliente inyecte un id_espacio distinto al que sincroniza).
 */
function _resolverYAplicarOperacion(op, idEspacio) {
  if (!op || !op.tipo || !op.entidad || !op.id) {
    return { op_id: op && op.op_id, estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'Cada operación requiere tipo, entidad e id.' };
  }

  if (op.entidad === 'pago_deuda') {
    return _procesarPagoDeudaSync(op, idEspacio);
  }

  var config = _configEntidadSync(op.entidad);
  if (!config) {
    return { op_id: op.op_id, estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'Entidad no soportada para sincronizar: ' + op.entidad };
  }

  var filaActual = buscarPorId(config.sheet, config.idCampo, op.id);
  var datosActuales = filaActual ? filaActual.datos : null;

  if (datosActuales && datosActuales.id_espacio !== idEspacio) {
    return { op_id: op.op_id, estado: 'rechazado', error: 'NO_ES_MIEMBRO', detalle: 'Ese registro pertenece a otro espacio.' };
  }

  if (op.tipo === 'crear' || op.tipo === 'editar') {
    if (op.tipo === 'crear' && op.datos) {
      op.datos.id_espacio = idEspacio;
    }
    var prep = config.validar(op.datos, op.tipo === 'crear');
    if (!prep.valido) {
      return { op_id: op.op_id, estado: 'rechazado', error: prep.error, detalle: prep.detalle };
    }
    var decision = resolverOperacion(op, datosActuales);
    return _aplicarDecisionSync(op, decision, config, filaActual, prep.datos);
  }

  if (op.tipo === 'eliminar') {
    var decisionEliminar = resolverOperacion(op, datosActuales);
    return _aplicarDecisionSync(op, decisionEliminar, config, filaActual, null);
  }

  return { op_id: op.op_id, estado: 'rechazado', error: 'CAMPO_REQUERIDO', detalle: 'Tipo de operación desconocido: ' + op.tipo };
}

/**
 * Registra el resultado de una operación ya aplicada en la hoja
 * `OperacionesAplicadas` y lo agrega al índice en memoria del lote, para que
 * una repetición del MISMO op_id más adelante en este mismo lote (cliente que
 * manda el mismo lote duplicado dentro de un solo request) también lo
 * encuentre sin volver a escribir.
 */
function _registrarOperacionAplicada(indice, opId, resultado) {
  var sheet = getSheet(SHEETS.OPERACIONES_APLICADAS);
  anexarFila(sheet, {
    op_id: opId,
    id_registro: (resultado && resultado.id) || '',
    rev: (resultado && resultado.rev !== undefined) ? resultado.rev : '',
    resultado: JSON.stringify(resultado),
    fecha: fechaHoraActual()
  });
  indice[opId] = resultado;
}

/** Lee `OperacionesAplicadas` UNA sola vez y arma el índice en memoria del lote (lib_sync.js, PURA). */
function _construirIndiceOpAplicadasDesdeSheet() {
  return construirIndiceOperaciones(getAllData(getSheet(SHEETS.OPERACIONES_APLICADAS)));
}

/**
 * Aplica la idempotencia de `op_id`: caché de lectura rápida (CacheService)
 * delante del índice persistente construido una sola vez al empezar el lote
 * (`indiceOpAplicadas`, respaldado por la hoja `OperacionesAplicadas`). Si
 * ninguno de los dos tiene el op_id, se resuelve y aplica la operación, y el
 * resultado se persiste en ambos antes de devolverlo.
 */
function _procesarOperacionSync(op, indiceOpAplicadas, idEspacio) {
  var cache = CacheService.getScriptCache();
  var opId = op && op.op_id;
  var claveCache = opId ? 'opid_' + opId : null;

  if (claveCache) {
    var previoCache = cache.get(claveCache);
    if (previoCache) {
      try { return JSON.parse(previoCache); } catch (error) { /* cache corrupto: recalcular abajo */ }
    }
  }

  if (opId) {
    var previoIndexado = buscarOperacionAplicada(indiceOpAplicadas, opId);
    if (previoIndexado) {
      if (claveCache) cache.put(claveCache, JSON.stringify(previoIndexado), _TTL_OPID_SEGUNDOS);
      return previoIndexado;
    }
  }

  var resultado = _resolverYAplicarOperacion(op, idEspacio);

  if (opId) {
    _registrarOperacionAplicada(indiceOpAplicadas, opId, resultado);
    if (claveCache) cache.put(claveCache, JSON.stringify(resultado), _TTL_OPID_SEGUNDOS);
  }

  return resultado;
}

/**
 * `idEspacio`: el lote y los `cambios` son POR ESPACIO (docs/CONTRACT.md § 0.3
 * y § 3) — solo se devuelve lo que pertenece al espacio que se está
 * sincronizando. `usuarios` es la única excepción: no tiene `id_espacio` (es
 * una tabla global, todo miembro activo pertenece a ambos espacios de todos
 * modos) y el cliente la necesita completa para atribuir nombres.
 */
function _construirCambiosSync(desde, idEspacio) {
  var transacciones = filtrarCambiosDesde(getAllData(getSheet(SHEETS.TRANSACCIONES)), desde)
    .filter(function (t) { return t.id_espacio === idEspacio; });
  var deudas = filtrarCambiosDesde(getAllData(getSheet(SHEETS.DEUDAS)), desde)
    .filter(function (d) { return d.id_espacio === idEspacio; });
  var presupuestos = filtrarCambiosDesde(getAllData(getSheet(SHEETS.PRESUPUESTOS)), desde)
    .filter(function (p) { return p.id_espacio === idEspacio; });

  // Categorías/cuentas no tienen `fecha_modificacion` en el esquema § 2 (no
  // son entidades sincronizables con rev/conflicto): son tablas de referencia
  // chicas (~10-20 filas por espacio) donde devolverlas completas en cada
  // sincronización es despreciable en costo.
  var categorias = getAllData(getSheet(SHEETS.CATEGORIAS)).filter(function (c) { return c.activo && c.id_espacio === idEspacio; });
  var cuentas = getAllData(getSheet(SHEETS.CUENTAS)).filter(function (c) { return c.activo && c.id_espacio === idEspacio; });
  // usuarioPublico: el hash y la sal de cada contraseña jamás viajan al teléfono de otro.
  var usuarios = getAllData(getSheet(SHEETS.USUARIOS)).filter(function (u) { return u.activo; }).map(usuarioPublico);
  // Activos e inactivos: los pagos a alguien que ya se fue tienen que seguir mostrando su nombre.
  var trabajadores = getAllData(getSheet(SHEETS.TRABAJADORES)).filter(function (t) { return t.id_espacio === idEspacio; });
  var prestamos = getAllData(getSheet(SHEETS.PRESTAMOS)).filter(function (p) { return p.id_espacio === idEspacio; });

  return {
    transacciones: transacciones,
    deudas: deudas,
    presupuestos: presupuestos,
    categorias: categorias,
    cuentas: cuentas,
    usuarios: usuarios,
    trabajadores: trabajadores,
    prestamos: prestamos
  };
}

/**
 * sincronizar({ id_espacio, desde, operaciones }, usuarioSesion) — docs/CONTRACT.md § 4
 * y § 0.3. El lote, sus resultados y los `cambios` son todos POR ESPACIO: el
 * request trae `id_espacio` (validado por el router contra la membresía del
 * usuario antes de llegar acá) y solo se aplican/devuelven operaciones de ese
 * espacio — una operación cuyo registro pertenece a otro se rechaza con
 * NO_ES_MIEMBRO sin abortar el resto del lote.
 * Todo el lote corre bajo un único LockService. El índice de idempotencia de
 * `op_id` se lee UNA vez al empezar el lote (no por cada operación) y se
 * mantiene en memoria.
 */
function sincronizar(datos) {
  if (!datos || !Object.prototype.toString.call(datos.operaciones).match(/Array/)) {
    return respuestaError('CAMPO_REQUERIDO', 'falta: operaciones');
  }
  if (!datos.id_espacio) {
    return respuestaError('CAMPO_REQUERIDO', 'falta: id_espacio');
  }

  return withLock(function () {
    var indiceOpAplicadas = _construirIndiceOpAplicadasDesdeSheet();
    var resultados = [];

    datos.operaciones.forEach(function (op) {
      try {
        resultados.push(_procesarOperacionSync(op, indiceOpAplicadas, datos.id_espacio));
      } catch (error) {
        resultados.push({ op_id: op && op.op_id, estado: 'rechazado', error: 'ERROR_INTERNO', detalle: error.toString() });
        registrarErrorSistema('Error procesando operación de sincronizar: ' + error.toString(), { op: op });
        reportarSentry(error, { fuente: 'sincronizar', op: op });
      }
    });

    var cambios = _construirCambiosSync(datos.desde, datos.id_espacio);
    var servidorTs = fechaHoraActual();

    return respuestaExito({ resultados: resultados, cambios: cambios, servidor_ts: servidorTs });
  });
}
