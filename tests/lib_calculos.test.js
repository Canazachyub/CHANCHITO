/**
 * Tests de backend/lib_calculos.js contra las firmas obligatorias de
 * docs/CONTRACT.md ("Firmas obligatorias de la lógica pura").
 */

let lib;
try {
  lib = require('../backend/lib_calculos.js');
} catch (e) {
  lib = null;
}

const describeIfExists = lib ? describe : describe.skip;

if (!lib) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/lib_calculos.test.js] backend/lib_calculos.js todavía no existe — ' +
    'se omiten los tests. Ver CONTRACT.md § "Firmas obligatorias de la lógica pura".'
  );
}

describeIfExists('lib_calculos', () => {
  describe('calcularBalance', () => {
    test('los ingresos suman', () => {
      const r = lib.calcularBalance([{ tipo: 'ingreso', monto: 100 }], 0);
      expect(r).toBe(100);
    });

    test('los gastos restan', () => {
      const r = lib.calcularBalance([{ tipo: 'gasto', monto: 30 }], 0);
      expect(r).toBe(-30);
    });

    test('combina ingresos y gastos con saldo inicial', () => {
      const r = lib.calcularBalance(
        [
          { tipo: 'ingreso', monto: 100 },
          { tipo: 'gasto', monto: 30 },
          { tipo: 'gasto', monto: 20 }
        ],
        50
      );
      expect(r).toBe(100);
    });

    test('lista vacía devuelve el saldo inicial tal cual', () => {
      expect(lib.calcularBalance([], 0)).toBe(0);
      expect(lib.calcularBalance([], 250.5)).toBe(250.5);
    });

    test('saldo inicial negativo se respeta', () => {
      expect(lib.calcularBalance([{ tipo: 'ingreso', monto: 10 }], -5)).toBe(5);
    });

    test('ignora transacciones con eliminado=true (borrado lógico)', () => {
      const r = lib.calcularBalance(
        [
          { tipo: 'ingreso', monto: 100, eliminado: false },
          { tipo: 'ingreso', monto: 999, eliminado: true }
        ],
        0
      );
      expect(r).toBe(100);
    });

    test('tolera entradas nulas/undefined en la lista sin reventar', () => {
      expect(() => lib.calcularBalance([null, undefined, { tipo: 'ingreso', monto: 10 }], 0)).not.toThrow();
    });
  });

  describe('calcularResumenMensual', () => {
    const transacciones = [
      { tipo: 'ingreso', monto: 1000, fecha: '2026-08-01' },
      { tipo: 'gasto', monto: 200, fecha: '2026-08-15' },
      { tipo: 'gasto', monto: 50, fecha: '2026-08-31' }, // borde: último día del mes
      { tipo: 'ingreso', monto: 500, fecha: '2026-07-31' }, // mes anterior, borde
      { tipo: 'gasto', monto: 999, fecha: '2026-09-01' }, // mes siguiente, borde
      { tipo: 'gasto', monto: 10, fecha: '2025-08-15' } // mismo mes, otro año
    ];

    test('filtra por mes y año correctamente, incluyendo bordes de mes', () => {
      const r = lib.calcularResumenMensual(transacciones, 8, 2026);
      expect(r.total_ingresos).toBe(1000);
      expect(r.total_gastos).toBe(250);
      expect(r.saldo).toBe(750);
    });

    test('no incluye transacciones de otro mes ni de otro año con el mismo mes', () => {
      const r = lib.calcularResumenMensual(transacciones, 8, 2026);
      // 500 (jul) y 999 (sep) y 10 (ago 2025) no deben contar
      expect(r.total_gastos).not.toBe(1249);
      expect(r.total_ingresos).not.toBe(1500);
    });

    test('mes sin transacciones devuelve todo en cero', () => {
      const r = lib.calcularResumenMensual(transacciones, 1, 2020);
      expect(r.total_ingresos).toBe(0);
      expect(r.total_gastos).toBe(0);
      expect(r.saldo).toBe(0);
    });

    test('lista vacía devuelve todo en cero', () => {
      const r = lib.calcularResumenMensual([], 8, 2026);
      expect(r).toEqual({ total_ingresos: 0, total_gastos: 0, saldo: 0 });
    });

    test('ignora transacciones eliminadas y sin fecha', () => {
      const r = lib.calcularResumenMensual(
        [
          { tipo: 'ingreso', monto: 1000, fecha: '2026-08-01', eliminado: true },
          { tipo: 'ingreso', monto: 200, fecha: '2026-08-01' },
          { tipo: 'gasto', monto: 50 } // sin fecha
        ],
        8,
        2026
      );
      expect(r.total_ingresos).toBe(200);
      expect(r.total_gastos).toBe(0);
    });
  });

  describe('calcularProgresoPresupuesto', () => {
    test('0% cuando no se gastó nada', () => {
      const r = lib.calcularProgresoPresupuesto(100, 0);
      expect(r.porcentaje).toBe(0);
      expect(r.excedido).toBe(false);
      expect(r.restante).toBe(100);
      expect(r.gastado).toBe(0);
      expect(r.limite).toBe(100);
    });

    test('50% cuando se gastó la mitad', () => {
      const r = lib.calcularProgresoPresupuesto(200, 100);
      expect(r.porcentaje).toBe(50);
      expect(r.excedido).toBe(false);
      expect(r.restante).toBe(100);
    });

    test('exactamente 100% no se marca como excedido', () => {
      const r = lib.calcularProgresoPresupuesto(150, 150);
      expect(r.porcentaje).toBe(100);
      expect(r.excedido).toBe(false);
      expect(r.restante).toBe(0);
    });

    test('gasto mayor al límite se marca excedido y el porcentaje pasa de 100', () => {
      const r = lib.calcularProgresoPresupuesto(100, 150);
      expect(r.porcentaje).toBeGreaterThan(100);
      expect(r.porcentaje).toBe(150);
      expect(r.excedido).toBe(true);
      expect(r.restante).toBeLessThan(0);
    });

    test('límite 0 no divide por cero: devuelve un porcentaje finito, sin NaN ni Infinity', () => {
      const rSinGasto = lib.calcularProgresoPresupuesto(0, 0);
      expect(Number.isFinite(rSinGasto.porcentaje)).toBe(true);
      expect(rSinGasto.excedido).toBe(false);

      const rConGasto = lib.calcularProgresoPresupuesto(0, 50);
      expect(Number.isFinite(rConGasto.porcentaje)).toBe(true);
      expect(Number.isNaN(rConGasto.porcentaje)).toBe(false);
      expect(rConGasto.excedido).toBe(true);
    });

    test('entradas no numéricas se tratan como 0, sin lanzar', () => {
      expect(() => lib.calcularProgresoPresupuesto('no-es-numero', 'tampoco')).not.toThrow();
      const r = lib.calcularProgresoPresupuesto(undefined, undefined);
      expect(r.limite).toBe(0);
      expect(r.gastado).toBe(0);
    });
  });

  describe('agruparPorCategoria', () => {
    const categorias = [
      { id_categoria: 'CAT_1', nombre: 'Comida' },
      { id_categoria: 'CAT_2', nombre: 'Transporte' },
      { id_categoria: 'CAT_3', nombre: 'Salud' }
    ];

    test('ordena de forma descendente por total', () => {
      const transacciones = [
        { id_categoria: 'CAT_1', tipo: 'gasto', monto: 50 },
        { id_categoria: 'CAT_2', tipo: 'gasto', monto: 200 },
        { id_categoria: 'CAT_3', tipo: 'gasto', monto: 100 }
      ];
      const r = lib.agruparPorCategoria(transacciones, categorias);
      expect(r.map((x) => x.id_categoria)).toEqual(['CAT_2', 'CAT_3', 'CAT_1']);
    });

    test('las proporciones suman aproximadamente 1', () => {
      const transacciones = [
        { id_categoria: 'CAT_1', tipo: 'gasto', monto: 30 },
        { id_categoria: 'CAT_2', tipo: 'gasto', monto: 70 }
      ];
      const r = lib.agruparPorCategoria(transacciones, categorias);
      const sumaProporciones = r.reduce((acc, x) => acc + x.proporcion, 0);
      expect(sumaProporciones).toBeCloseTo(1, 5);
      r.forEach((x) => {
        expect(x.proporcion).toBeGreaterThanOrEqual(0);
        expect(x.proporcion).toBeLessThanOrEqual(1);
      });
    });

    test('sin transacciones devuelve array vacío, sin dividir por cero', () => {
      const r = lib.agruparPorCategoria([], categorias);
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBe(0);
    });

    test('ignora transacciones eliminadas y usa "Sin categoría" para categorías desconocidas', () => {
      const transacciones = [
        { id_categoria: 'CAT_1', tipo: 'gasto', monto: 50, eliminado: true },
        { id_categoria: 'CAT_INEXISTENTE', tipo: 'gasto', monto: 30 }
      ];
      const r = lib.agruparPorCategoria(transacciones, categorias);
      expect(r.length).toBe(1);
      expect(r[0].id_categoria).toBe('CAT_INEXISTENTE');
      expect(r[0].nombre).toBe('Sin categoría');
      expect(r[0].proporcion).toBeCloseTo(1);
    });
  });

  describe('calcularTendencia', () => {
    // hoy inyectado para que el test sea determinista sin importar el día real de ejecución.
    const hoy = new Date('2026-08-02T12:00:00');

    const transacciones = [
      { tipo: 'ingreso', monto: 1000, fecha: '2026-06-10' },
      { tipo: 'gasto', monto: 200, fecha: '2026-06-15' },
      { tipo: 'ingreso', monto: 1200, fecha: '2026-07-05' },
      { tipo: 'gasto', monto: 300, fecha: '2026-07-20' },
      { tipo: 'ingreso', monto: 1100, fecha: '2026-08-01' },
      { tipo: 'gasto', monto: 400, fecha: '2026-08-02' }
    ];

    test('devuelve `meses` entradas terminando en el mes de "hoy"', () => {
      const r = lib.calcularTendencia(transacciones, 3, hoy);
      expect(r.length).toBe(3);
      const ultimo = r[r.length - 1];
      expect(ultimo.mes).toBe(8);
      expect(ultimo.anio).toBe(2026);
    });

    test('calcula ingresos y gastos correctos por mes', () => {
      const r = lib.calcularTendencia(transacciones, 3, hoy);
      const junio = r.find((x) => x.mes === 6 && x.anio === 2026);
      const julio = r.find((x) => x.mes === 7 && x.anio === 2026);
      const agosto = r.find((x) => x.mes === 8 && x.anio === 2026);

      expect(junio.ingresos).toBe(1000);
      expect(junio.gastos).toBe(200);
      expect(julio.ingresos).toBe(1200);
      expect(julio.gastos).toBe(300);
      expect(agosto.ingresos).toBe(1100);
      expect(agosto.gastos).toBe(400);
    });

    test('respeta el cruce de año (diciembre → enero)', () => {
      const hoyEnero = new Date('2026-01-15T00:00:00');
      const txsFinDeAnio = [
        { tipo: 'ingreso', monto: 500, fecha: '2025-12-20' },
        { tipo: 'ingreso', monto: 700, fecha: '2026-01-05' }
      ];
      const r = lib.calcularTendencia(txsFinDeAnio, 2, hoyEnero);
      expect(r.length).toBe(2);
      const dic = r.find((x) => x.mes === 12 && x.anio === 2025);
      const ene = r.find((x) => x.mes === 1 && x.anio === 2026);
      expect(dic).toBeDefined();
      expect(ene).toBeDefined();
      expect(dic.ingresos).toBe(500);
      expect(ene.ingresos).toBe(700);
    });

    test('sin `meses` explícito usa un valor por defecto razonable (no revienta)', () => {
      const r = lib.calcularTendencia([], undefined, hoy);
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBeGreaterThan(0);
      expect(r[r.length - 1]).toEqual({ mes: 8, anio: 2026, ingresos: 0, gastos: 0 });
    });
  });

  describe('diasHastaVencimiento', () => {
    const hoy = new Date('2026-08-02T00:00:00');

    test('fecha futura devuelve un entero positivo', () => {
      expect(lib.diasHastaVencimiento('2026-08-12', hoy)).toBe(10);
    });

    test('hoy mismo devuelve 0', () => {
      expect(lib.diasHastaVencimiento('2026-08-02', hoy)).toBe(0);
    });

    test('fecha vencida devuelve un entero negativo', () => {
      expect(lib.diasHastaVencimiento('2026-07-28', hoy)).toBe(-5);
    });

    test('fechaVencimiento vacía o inválida no revienta (NaN, no lanza excepción)', () => {
      expect(() => lib.diasHastaVencimiento('', hoy)).not.toThrow();
      expect(() => lib.diasHastaVencimiento(null, hoy)).not.toThrow();
      expect(() => lib.diasHastaVencimiento('fecha-basura', hoy)).not.toThrow();
    });
  });
});
