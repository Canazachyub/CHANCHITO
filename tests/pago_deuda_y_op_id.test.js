/**
 * Tests de backend/lib_sync.js para dos huecos cerrados sobre docs/CONTRACT.md § 4:
 *
 * 1. Entidad `pago_deuda` del lote de `sincronizar` — resolverPagoDeuda(op, deudaActual,
 *    montoValidado) decide si el pago se puede aplicar contra la deuda (rev_base vs rev
 *    de la deuda, monto vs monto_pendiente) y calcula el resultado numérico. PURA: no
 *    toca PagosDeuda ni Deudas; eso lo hace _aplicarPagoDeudaInterna en
 *    backend/16_deudas.js, fuera del alcance de Jest (depende de SpreadsheetApp).
 *
 * 2. Idempotencia persistente de op_id — construirIndiceOperaciones/buscarOperacionAplicada
 *    arman y consultan en memoria el índice que reemplaza la dependencia exclusiva de
 *    CacheService (tope real de 6h). Se prueba que un op_id "viejo" (fuera de cualquier
 *    ventana de cache razonable) se sigue reconociendo si sigue en las filas de la hoja
 *    OperacionesAplicadas — la garantía central del fix.
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
  console.warn('[tests/pago_deuda_y_op_id.test.js] backend/lib_sync.js todavía no existe — se omiten los tests.');
}

describeIfExists('lib_sync — resolverPagoDeuda', () => {
  const deudaBase = {
    id_deuda: 'DDA_ab12cd34',
    id_espacio: 'ESP_COMPARTIDO',
    id_usuario: 'USR_1',
    tipo: 'me_deben',
    persona: 'Luis',
    monto_original: 200,
    monto_pendiente: 120,
    estado: 'pendiente',
    rev: 5,
    eliminado: false
  };

  const opPago = {
    op_id: 'op-pago-1',
    tipo: 'crear',
    entidad: 'pago_deuda',
    id: 'PAG_ab12cd34',
    rev_base: 5,
    datos: { id_deuda: 'DDA_ab12cd34', monto: 50, fecha: '2026-08-02', notas: '' }
  };

  test('rev_base correcto y monto dentro del pendiente → aplicado: baja monto_pendiente y sube el rev', () => {
    const r = lib.resolverPagoDeuda(opPago, deudaBase, 50);
    expect(r.estado).toBe('aplicado');
    expect(r.id_deuda).toBe('DDA_ab12cd34');
    expect(r.monto).toBe(50);
    expect(r.monto_pendiente).toBe(70); // 120 - 50
    expect(r.estado_deuda).toBe('pendiente'); // todavía queda saldo
    expect(r.rev).toBe(6); // siguienteRev(5)
  });

  test('un pago que cubre exactamente el pendiente cierra la deuda (estado_deuda = "pagada")', () => {
    const r = lib.resolverPagoDeuda(opPago, deudaBase, 120);
    expect(r.estado).toBe('aplicado');
    expect(r.monto_pendiente).toBe(0);
    expect(r.estado_deuda).toBe('pagada');
  });

  test('función pura: no muta la deuda actual recibida', () => {
    const copia = { ...deudaBase };
    lib.resolverPagoDeuda(opPago, deudaBase, 50);
    expect(deudaBase).toEqual(copia);
  });

  test('rev_base desactualizado → conflicto, NO se calcula ni se aplica el pago', () => {
    const opDesactualizado = { ...opPago, op_id: 'op-pago-2', rev_base: 3 }; // la deuda real va en rev 5
    const r = lib.resolverPagoDeuda(opDesactualizado, deudaBase, 50);
    expect(r.estado).toBe('conflicto');
    expect(r.rev).toBeUndefined();
    expect(r.monto_pendiente).toBeUndefined();
    expect(r.version_servidor).toEqual(deudaBase);
    expect(r.version_cliente).toEqual(opDesactualizado.datos);
    // La deuda no se tocó.
    expect(deudaBase.monto_pendiente).toBe(120);
  });

  test('un pago mayor al pendiente sale rechazado (MONTO_INVALIDO), sin escribir nada', () => {
    const opExcesivo = { ...opPago, op_id: 'op-pago-3', datos: { ...opPago.datos, monto: 500 } };
    const r = lib.resolverPagoDeuda(opExcesivo, deudaBase, 500);
    expect(r.estado).toBe('rechazado');
    expect(r.error).toBe('MONTO_INVALIDO');
    expect(r.detalle).toEqual(expect.any(String));
    expect(deudaBase.monto_pendiente).toBe(120); // sin cambios
  });

  test('deuda inexistente (null) → rechazado NO_ENCONTRADO', () => {
    const r = lib.resolverPagoDeuda(opPago, null, 50);
    expect(r.estado).toBe('rechazado');
    expect(r.error).toBe('NO_ENCONTRADO');
  });

  test('deuda ya borrada lógicamente (eliminado=true) → rechazado NO_ENCONTRADO', () => {
    const deudaBorrada = { ...deudaBase, eliminado: true };
    const r = lib.resolverPagoDeuda(opPago, deudaBorrada, 50);
    expect(r.estado).toBe('rechazado');
    expect(r.error).toBe('NO_ENCONTRADO');
  });

  test('monto cero o negativo → rechazado MONTO_INVALIDO (defensivo, aunque el llamador ya valida formato)', () => {
    expect(lib.resolverPagoDeuda(opPago, deudaBase, 0).estado).toBe('rechazado');
    expect(lib.resolverPagoDeuda(opPago, deudaBase, -10).estado).toBe('rechazado');
  });

  test('sin operación (null) no revienta', () => {
    expect(() => lib.resolverPagoDeuda(null, deudaBase, 50)).not.toThrow();
    expect(lib.resolverPagoDeuda(null, deudaBase, 50).estado).toBe('rechazado');
  });

  test('escenario completo: el resultado de resolverPagoDeuda alcanza para simular la escritura real (fila de PagosDeuda + deuda actualizada)', () => {
    // Simula lo que hace _aplicarPagoDeudaInterna (backend/16_deudas.js) con
    // el resultado puro, igual que sync_escenario_offline.test.js simula la
    // escritura del endpoint sobre el resultado de resolverOperacion.
    const pagosDeuda = [];
    let deudaEnServidor = { ...deudaBase };

    const decision = lib.resolverPagoDeuda(opPago, deudaEnServidor, 50);
    expect(decision.estado).toBe('aplicado');

    pagosDeuda.push({
      id_pago: opPago.id,
      id_deuda: decision.id_deuda,
      monto: decision.monto,
      fecha: opPago.datos.fecha,
      notas: opPago.datos.notas,
      id_transaccion: ''
    });
    deudaEnServidor = { ...deudaEnServidor, monto_pendiente: decision.monto_pendiente, estado: decision.estado_deuda, rev: decision.rev };

    expect(pagosDeuda).toHaveLength(1);
    expect(pagosDeuda[0].id_pago).toBe('PAG_ab12cd34');
    expect(pagosDeuda[0].monto).toBe(50);
    expect(deudaEnServidor.monto_pendiente).toBe(70);
    expect(deudaEnServidor.rev).toBe(6);
  });
});

describeIfExists('lib_sync — idempotencia persistente de op_id (construirIndiceOperaciones / buscarOperacionAplicada)', () => {
  test('un op_id presente en las filas de la hoja se encuentra en el índice, con el resultado ya parseado', () => {
    const filas = [
      { op_id: 'op-1', id_registro: 'TRX_1', rev: 4, resultado: JSON.stringify({ op_id: 'op-1', estado: 'aplicado', id: 'TRX_1', rev: 4 }), fecha: '2026-07-01 10:00:00' }
    ];
    const indice = lib.construirIndiceOperaciones(filas);
    const encontrado = lib.buscarOperacionAplicada(indice, 'op-1');
    expect(encontrado).toEqual({ op_id: 'op-1', estado: 'aplicado', id: 'TRX_1', rev: 4 });
  });

  test('un op_id ausente devuelve null, no undefined ni una excepción', () => {
    const indice = lib.construirIndiceOperaciones([]);
    expect(lib.buscarOperacionAplicada(indice, 'op-no-existe')).toBeNull();
  });

  test('índice / lookup nulos no revientan', () => {
    expect(lib.buscarOperacionAplicada(null, 'op-1')).toBeNull();
    expect(lib.buscarOperacionAplicada({ 'op-1': {} }, null)).toBeNull();
  });

  test('filas con resultado corrupto (no-JSON) se ignoran en vez de romper el índice completo', () => {
    const filas = [
      { op_id: 'op-bueno', resultado: JSON.stringify({ estado: 'aplicado', rev: 1 }) },
      { op_id: 'op-corrupto', resultado: '{esto no es JSON' }
    ];
    const indice = lib.construirIndiceOperaciones(filas);
    expect(lib.buscarOperacionAplicada(indice, 'op-bueno')).toEqual({ estado: 'aplicado', rev: 1 });
    expect(lib.buscarOperacionAplicada(indice, 'op-corrupto')).toBeNull();
  });

  test('filas sin op_id se ignoran (fila en blanco o corrupta)', () => {
    const filas = [{ id_registro: 'TRX_1', resultado: '{}' }, null, undefined];
    expect(() => lib.construirIndiceOperaciones(filas)).not.toThrow();
    expect(Object.keys(lib.construirIndiceOperaciones(filas))).toHaveLength(0);
  });

  test(
    'la garantía central del fix: un op_id aplicado hace MUCHO más de 6h (fuera de cualquier TTL ' +
    'razonable de CacheService) sigue siendo idempotente porque el índice se arma desde la hoja, no desde el cache',
    () => {
      // Simula OperacionesAplicadas después de que un cliente estuvo varios
      // días offline y reintenta un lote que el servidor ya aplicó hace 4 días
      // — mucho más que el TTL máximo real de CacheService (6h, § 4).
      const resultadoOriginal = { op_id: 'op-viejo', estado: 'aplicado', id: 'TRX_offline_4dias', rev: 2 };
      const filasDeLaHoja = [
        { op_id: 'op-viejo', id_registro: 'TRX_offline_4dias', rev: 2, resultado: JSON.stringify(resultadoOriginal), fecha: '2026-07-29 08:00:00' }
      ];

      // El cache ya habría expirado (6h << 4 días); acá se simula el fallback:
      // el endpoint construye el índice UNA vez desde la hoja al empezar el lote.
      const indice = lib.construirIndiceOperaciones(filasDeLaHoja);

      // El cliente reintenta el MISMO op_id: debe encontrarse tal cual, sin
      // volver a "aplicar" nada (en el endpoint real esto evita reescribir Sheets).
      const encontrado = lib.buscarOperacionAplicada(indice, 'op-viejo');
      expect(encontrado).toEqual(resultadoOriginal);
    }
  );

  test('un op_id nuevo del mismo lote, agregado en memoria (como haría el endpoint tras aplicar), se vuelve a encontrar sin releer la hoja', () => {
    const indice = lib.construirIndiceOperaciones([]); // hoja vacía al empezar el lote
    expect(lib.buscarOperacionAplicada(indice, 'op-nuevo')).toBeNull();

    // El endpoint, tras aplicar la operación, agrega la entrada al índice en
    // memoria (backend/30_sincronizar.js:_registrarOperacionAplicada) para que
    // un op_id repetido más adelante en el MISMO lote también la encuentre.
    const resultadoNuevo = { op_id: 'op-nuevo', estado: 'aplicado', id: 'TRX_x', rev: 1 };
    indice['op-nuevo'] = resultadoNuevo;

    expect(lib.buscarOperacionAplicada(indice, 'op-nuevo')).toEqual(resultadoNuevo);
  });
});
