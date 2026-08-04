/**
 * Aislamiento entre espacios (docs/CONTRACT.md § 0.3 y § 3, "Alcance por
 * espacio"): "Balances, categorías, presupuestos, deudas y obligaciones son
 * por espacio y nunca se suman entre sí." y "Nunca se devuelve data de un
 * espacio del que el usuario no es miembro, ni siquiera agregada."
 *
 * lib_calculos.js es deliberadamente agnóstico de `id_espacio` (no está en
 * las firmas obligatorias de docs/CONTRACT.md): el filtrado por espacio es
 * responsabilidad del llamador (getDashboard, getResumenMensual, etc. en
 * backend/22_dashboard.js — fuera del alcance de Jest porque dependen de
 * SpreadsheetApp). Este test fija el patrón correcto — filtrar por
 * `id_espacio` ANTES de pasarle la lista a las funciones puras — y prueba
 * que, aplicado así, un dato de ESP_TELCOM jamás contamina un cálculo de
 * ESP_FAMILIA ni viceversa. Es la protección de la razón de ser del cambio a
 * dos espacios: si esto se rompe, un mes con mucho gasto de empresa infla en
 * silencio el balance de la casa.
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
    '[tests/aislamiento_espacios.test.js] backend/lib_calculos.js todavía no existe — ' +
    'se omiten los tests. Ver CONTRACT.md § "Firmas obligatorias de la lógica pura".'
  );
}

/** Igual al patrón que usan los dominios reales (p.ej. backend/14_transacciones.js
 * línea ~126: `getAllData(sheet).filter(t => t.id_espacio === idEsp && !t.eliminado)`). */
function filtrarPorEspacio(filas, idEspacio) {
  return (filas || []).filter((f) => f && f.id_espacio === idEspacio && !f.eliminado);
}

const ESP_FAMILIA = 'ESP_FAMILIA';
const ESP_TELCOM = 'ESP_TELCOM';

describeIfExists('Aislamiento entre ESP_FAMILIA y ESP_TELCOM (lógica pura de lib_calculos.js)', () => {
  // Un mes con gasto de empresa mucho más alto que el de la casa: si algo
  // mezclara los espacios, el balance/resumen de Familia quedaría claramente
  // contaminado por los montos de Telcom (y viceversa).
  const transaccionesMixtas = [
    { id_espacio: ESP_FAMILIA, tipo: 'gasto', monto: 50, id_categoria: 'CAT_comida', fecha: '2026-08-02', eliminado: false },
    { id_espacio: ESP_FAMILIA, tipo: 'ingreso', monto: 1000, id_categoria: 'CAT_sueldo', fecha: '2026-08-01', eliminado: false },
    { id_espacio: ESP_TELCOM, tipo: 'gasto', monto: 5000, id_categoria: 'CAT_planilla', fecha: '2026-08-02', eliminado: false },
    { id_espacio: ESP_TELCOM, tipo: 'gasto', monto: 3000, id_categoria: 'CAT_impuestos', fecha: '2026-08-03', eliminado: false },
    { id_espacio: ESP_TELCOM, tipo: 'ingreso', monto: 12000, id_categoria: 'CAT_facturado', fecha: '2026-08-01', eliminado: false }
  ];

  test('calcularBalance de Familia no incluye montos de Telcom', () => {
    const balanceFamilia = lib.calcularBalance(filtrarPorEspacio(transaccionesMixtas, ESP_FAMILIA), 0);
    // 1000 (ingreso) - 50 (gasto) = 950. Si Telcom se colara, el número sería
    // muchísimo mayor (Telcom mueve miles).
    expect(balanceFamilia).toBe(950);
  });

  test('calcularBalance de Telcom no incluye montos de Familia', () => {
    const balanceTelcom = lib.calcularBalance(filtrarPorEspacio(transaccionesMixtas, ESP_TELCOM), 0);
    // 12000 - 5000 - 3000 = 4000
    expect(balanceTelcom).toBe(4000);
  });

  test('la suma de los dos balances por separado NO es igual al balance de la lista sin filtrar (nunca se suman entre sí)', () => {
    const balanceFamilia = lib.calcularBalance(filtrarPorEspacio(transaccionesMixtas, ESP_FAMILIA), 0);
    const balanceTelcom = lib.calcularBalance(filtrarPorEspacio(transaccionesMixtas, ESP_TELCOM), 0);
    const balanceSinFiltrar = lib.calcularBalance(transaccionesMixtas, 0);

    // Confirma que hay data real de ambos lados (si no, el test no probaría nada).
    expect(balanceFamilia).not.toBe(balanceTelcom);
    // El balance "global" existe como número, pero ningún endpoint real debe
    // producirlo: getDashboard/getResumenMensual siempre filtran antes.
    expect(balanceSinFiltrar).toBe(balanceFamilia + balanceTelcom);
    expect(balanceFamilia).not.toBe(balanceSinFiltrar);
    expect(balanceTelcom).not.toBe(balanceSinFiltrar);
  });

  test('calcularResumenMensual de un espacio no ve los totales del otro', () => {
    const resumenFamilia = lib.calcularResumenMensual(filtrarPorEspacio(transaccionesMixtas, ESP_FAMILIA), 8, 2026);
    const resumenTelcom = lib.calcularResumenMensual(filtrarPorEspacio(transaccionesMixtas, ESP_TELCOM), 8, 2026);

    expect(resumenFamilia).toEqual({ total_ingresos: 1000, total_gastos: 50, saldo: 950 });
    expect(resumenTelcom).toEqual({ total_ingresos: 12000, total_gastos: 8000, saldo: 4000 });
  });

  test('agruparPorCategoria de Familia no arrastra categorías de Telcom, ni sus proporciones se recalculan sobre el total mezclado', () => {
    const categorias = [
      { id_categoria: 'CAT_comida', nombre: 'Comida', icono: '🍴', color: '#FF453A' },
      { id_categoria: 'CAT_planilla', nombre: 'Sueldos y honorarios', icono: '💼', color: '#0A84FF' },
      { id_categoria: 'CAT_impuestos', nombre: 'Impuestos y SUNAT', icono: '🧾', color: '#FF9F0A' }
    ];

    // Igual que el patrón real (backend/22_dashboard.js: getDashboard/getTopCategorias),
    // agruparPorCategoria se llama solo con gastos, ya filtrados por espacio.
    const soloGastos = (filas) => filas.filter((f) => f.tipo === 'gasto');

    const gruposFamilia = lib.agruparPorCategoria(soloGastos(filtrarPorEspacio(transaccionesMixtas, ESP_FAMILIA)), categorias);
    expect(gruposFamilia).toHaveLength(1);
    expect(gruposFamilia[0].id_categoria).toBe('CAT_comida');
    expect(gruposFamilia[0].total).toBe(50);
    // Proporción calculada solo contra el total de Familia (50), no contra el
    // total mezclado con Telcom (que la haría minúscula).
    expect(gruposFamilia[0].proporcion).toBe(1);

    const gruposTelcom = lib.agruparPorCategoria(soloGastos(filtrarPorEspacio(transaccionesMixtas, ESP_TELCOM)), categorias);
    expect(gruposTelcom).toHaveLength(2);
    expect(gruposTelcom.map((g) => g.id_categoria).sort()).toEqual(['CAT_impuestos', 'CAT_planilla']);
    // Ninguna fila de Familia (CAT_comida) aparece del lado de Telcom.
    expect(gruposTelcom.find((g) => g.id_categoria === 'CAT_comida')).toBeUndefined();
  });

  test('un espacio sin transacciones propias da balance/resumen en cero, nunca "hereda" del otro espacio', () => {
    const soloTelcom = [{ id_espacio: ESP_TELCOM, tipo: 'gasto', monto: 100, fecha: '2026-08-02', eliminado: false }];
    expect(lib.calcularBalance(filtrarPorEspacio(soloTelcom, ESP_FAMILIA), 0)).toBe(0);
    expect(lib.calcularResumenMensual(filtrarPorEspacio(soloTelcom, ESP_FAMILIA), 8, 2026)).toEqual({
      total_ingresos: 0,
      total_gastos: 0,
      saldo: 0
    });
  });

  test('una transacción borrada lógicamente (eliminado=true) de un espacio no cuenta ni ahí ni en el otro', () => {
    const conBorrada = [
      { id_espacio: ESP_TELCOM, tipo: 'gasto', monto: 999, fecha: '2026-08-02', eliminado: true },
      { id_espacio: ESP_TELCOM, tipo: 'gasto', monto: 10, fecha: '2026-08-02', eliminado: false }
    ];
    const balance = lib.calcularBalance(filtrarPorEspacio(conBorrada, ESP_TELCOM), 0);
    expect(balance).toBe(-10); // no -1009
  });
});
