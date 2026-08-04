/**
 * Escenario completo — README § 11 "Prueba de conflicto de sincronización":
 * simular dos ediciones offline del MISMO registro desde dos dispositivos,
 * aplicadas en secuencia contra resolverOperacion, y confirmar que el sistema
 * muestra el conflicto en vez de perder una de las dos ediciones.
 *
 * resolverOperacion (backend/lib_sync.js) solo decide 'aplicado'/'conflicto'/
 * 'rechazado' y la próxima rev — no fusiona los datos en la fila (eso lo hace
 * el endpoint `sincronizar`, backend/30_sincronizar.js, vía las funciones
 * `actualizarInterna` de cada dominio, fuera del alcance de esta prueba pura).
 * Por eso este test simula ese paso de fusión con un helper propio, tal como lo
 * haría el endpoint, para poder encadenar la segunda sincronización sobre el
 * estado que quedó en el servidor después de la primera.
 */

let lib;
try {
  lib = require('../backend/lib_sync.js');
} catch (e) {
  lib = null;
}

const describeIfExists = lib ? describe : describe.skip;

if (!lib) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/sync_escenario_offline.test.js] backend/lib_sync.js todavía no existe — ' +
    'se omite el escenario. Ver CONTRACT.md § "Firmas obligatorias de la lógica pura".'
  );
}

/** Simula lo que hace el endpoint al aplicar una edición: fusiona `datos` sobre la fila y sube el rev. */
function simularEscrituraServidor(filaActual, datos, nuevaRev) {
  return { ...filaActual, ...datos, rev: nuevaRev };
}

describeIfExists('Escenario: dos ediciones offline del mismo registro desde dos dispositivos', () => {
  test('la segunda sincronización en llegar sale en conflicto y NINGUNA de las dos ediciones se pierde', () => {
    // Estado inicial en el servidor, antes de que ambos dispositivos se desconecten.
    const filaServidorOriginal = {
      id_transaccion: 'TRX_compartida',
      id_espacio: 'ESP_COMPARTIDO',
      id_usuario: 'USR_ana',
      monto: 45.9,
      descripcion: 'Supermercado',
      categoria: 'Comida',
      rev: 1,
      origen: 'app',
      eliminado: false,
      fecha_modificacion: '2026-08-01 09:00:00'
    };

    // Ambos dispositivos descargan la misma fila (rev 1) y luego pierden conexión.
    const dispositivoA_revBase = filaServidorOriginal.rev; // 1
    const dispositivoB_revBase = filaServidorOriginal.rev; // 1

    // Offline, cada uno edita algo distinto del mismo registro.
    const opDispositivoA = {
      op_id: 'op-device-A',
      tipo: 'editar',
      entidad: 'transaccion',
      id: 'TRX_compartida',
      rev_base: dispositivoA_revBase,
      datos: { monto: 50, descripcion: 'Supermercado (corregido)' }
    };

    const opDispositivoB = {
      op_id: 'op-device-B',
      tipo: 'editar',
      entidad: 'transaccion',
      id: 'TRX_compartida',
      rev_base: dispositivoB_revBase,
      datos: { categoria: 'Otros gastos', descripcion: 'Super del finde' }
    };

    // --- El dispositivo A sincroniza primero ---
    let filaEnServidor = { ...filaServidorOriginal };
    const resultadoA = lib.resolverOperacion(opDispositivoA, filaEnServidor);

    expect(resultadoA.estado).toBe('aplicado');
    expect(resultadoA.rev).toBe(2);

    // El servidor persiste el resultado de A (esto es lo que haría 30_sincronizar.js
    // llamando a actualizarTransaccionInterna).
    filaEnServidor = simularEscrituraServidor(filaEnServidor, opDispositivoA.datos, resultadoA.rev);
    expect(filaEnServidor.monto).toBe(50);
    expect(filaEnServidor.descripcion).toBe('Supermercado (corregido)');

    // --- El dispositivo B sincroniza después, todavía con rev_base = 1 ---
    const resultadoB = lib.resolverOperacion(opDispositivoB, filaEnServidor);

    // La edición de B llega en conflicto: su rev_base (1) ya no coincide con el
    // rev actual del servidor (2, gracias a A).
    expect(resultadoB.estado).toBe('conflicto');
    expect(resultadoB.rev).toBeUndefined();

    // Ninguna de las dos ediciones se perdió:
    // 1. La de A quedó aplicada y persistida en el servidor.
    expect(filaEnServidor.monto).toBe(50);
    expect(filaEnServidor.descripcion).toBe('Supermercado (corregido)');
    expect(filaEnServidor.rev).toBe(2);

    // 2. La de B no se sobrescribió ni se descartó: viaja completa en `version_cliente`
    //    para que la persona la vea y decida, junto con la versión actual del servidor.
    expect(resultadoB.version_cliente).toEqual(opDispositivoB.datos);
    expect(resultadoB.version_cliente.categoria).toBe('Otros gastos');
    expect(resultadoB.version_servidor).toEqual(filaEnServidor);

    // 3. El registro real del servidor NO quedó con los cambios de B aplicados a la fuerza.
    expect(filaEnServidor.categoria).not.toBe('Otros gastos');
  });

  test('caso feliz: dos dispositivos editan registros DISTINTOS y ambos se aplican sin pisarse', () => {
    const filaTrxUno = { id_transaccion: 'TRX_uno', monto: 10, rev: 1, eliminado: false };
    const filaTrxDos = { id_transaccion: 'TRX_dos', monto: 20, rev: 1, eliminado: false };

    const opUno = {
      op_id: 'op-uno',
      tipo: 'editar',
      entidad: 'transaccion',
      id: 'TRX_uno',
      rev_base: 1,
      datos: { monto: 15 }
    };
    const opDos = {
      op_id: 'op-dos',
      tipo: 'editar',
      entidad: 'transaccion',
      id: 'TRX_dos',
      rev_base: 1,
      datos: { monto: 25 }
    };

    const resultadoUno = lib.resolverOperacion(opUno, filaTrxUno);
    const resultadoDos = lib.resolverOperacion(opDos, filaTrxDos);

    expect(resultadoUno.estado).toBe('aplicado');
    expect(resultadoDos.estado).toBe('aplicado');
    expect(resultadoUno.rev).toBe(2);
    expect(resultadoDos.rev).toBe(2);
  });
});
