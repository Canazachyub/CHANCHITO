/**
 * Obligaciones mensuales (docs/CONTRACT.md § 4-ter): generación idempotente de
 * la Deuda del mes a partir de una obligación activa, con el caso clásico del
 * día 29/30/31 en un mes que no lo tiene — "Febrero existe y rompe las cosas."
 *
 * A la fecha de este test, la lógica de generación vive (o va a vivir) en
 * backend/23_solicitudes.js / backend/24_obligaciones.js (contrato de nombres
 * en docs/CONTRACT.md § "Acciones POST", `generarObligacionesDelMes()`), que
 * NO son lib_*.js: dependen de SpreadsheetApp y no son testeables por Jest
 * (docs/CONTRACT.md § 1, "Regla de compatibilidad Apps Script ↔ Jest"; ver
 * también jest.config.js). Para que el caso del 29/30/31 tenga cobertura real
 * hace falta aislar dos piezas PURAS — ninguna de las dos existe todavía en
 * este repo, así que los describe de abajo se saltan agraciadamente (mismo
 * patrón que tests/lib_calculos.test.js) hasta que el agente de backend las
 * agregue. Quedan documentadas acá con la firma recomendada para que, en
 * cuanto existan, esta cobertura se active sin tocar el test:
 *
 *   // backend/lib_calculos.js (agregado sugerido, encaja con diasHastaVencimiento
 *   // y _parsearFechaLocal que ya viven ahí)
 *   resolverFechaVencimientoMensual(diaVencimiento, mes, anio)
 *     // → 'yyyy-MM-dd'. Si diaVencimiento no existe en ese mes (29/30/31 en
 *     //   un mes más corto), usa el ÚLTIMO día real del mes. NUNCA usar
 *     //   `new Date(anio, mes-1, diaVencimiento)` directo: en JS eso "rueda"
 *     //   en silencio al mes siguiente en vez de fallar o clampear.
 *
 *   // backend/lib_obligaciones.js (archivo nuevo sugerido, mismo patrón que
 *   // lib_sync.js: PURO, sin SpreadsheetApp, exporta con `if (typeof module
 *   // !== 'undefined')`)
 *   periodoActual(fecha) → 'yyyy-MM'
 *   debeGenerarPeriodo(ultimoPeriodoGenerado, periodoActual) → bool
 *     // true si ultimoPeriodoGenerado es null/'' o distinto de periodoActual.
 *     // Es el único guardián de la idempotencia (§ 4-ter: "correr el trigger
 *     // diez veces el mismo día genera una sola deuda").
 *
 * No es responsabilidad de este agente (dueño de tests/**, no de backend/lib_*.js)
 * crear esos archivos — así lo pide la tarea explícitamente. Se deja reportado.
 */

// ---------------------------------------------------------------------------
// Este bloque SIEMPRE corre (no depende de ningún módulo del proyecto):
// documenta el bug de raíz que motiva resolverFechaVencimientoMensual, para
// que quede registrado en la suite por qué la función tiene que existir y no
// alcanza con `new Date(anio, mes - 1, dia)` a secas.
// ---------------------------------------------------------------------------
describe('bug clásico de JS Date: día que no existe en el mes "rueda" al mes siguiente en silencio', () => {
  test('new Date(2026, 1, 31) no es 31 de febrero: es marzo', () => {
    // mes 1 = febrero (0-indexado). 2026 no es bisiesto → febrero tiene 28 días.
    const fecha = new Date(2026, 1, 31);
    expect(fecha.getMonth()).toBe(2); // 2 = marzo, NO 1 (febrero)
    expect(fecha.getDate()).toBe(3); // 31 - 28 = 3 de marzo
  });

  test('mismo bug en año bisiesto con día 30: new Date(2024, 1, 30) también rueda a marzo', () => {
    const fecha = new Date(2024, 1, 30); // 2024 es bisiesto: febrero tiene 29 días
    expect(fecha.getMonth()).toBe(2);
    expect(fecha.getDate()).toBe(1); // 30 - 29 = 1 de marzo
  });

  test('en cambio, día 29 en 2024 (bisiesto) SÍ es válido y no rueda', () => {
    const fecha = new Date(2024, 1, 29);
    expect(fecha.getMonth()).toBe(1); // sigue en febrero
    expect(fecha.getDate()).toBe(29);
  });
});

let libCalc;
try {
  libCalc = require('../backend/lib_calculos.js');
} catch (e) {
  libCalc = null;
}

let libObligaciones;
try {
  libObligaciones = require('../backend/lib_obligaciones.js');
} catch (e) {
  libObligaciones = null;
}

const tieneResolverFecha = !!(libCalc && typeof libCalc.resolverFechaVencimientoMensual === 'function');
const tieneLibObligaciones = !!(libObligaciones && typeof libObligaciones.debeGenerarPeriodo === 'function');

const describeIfResolverFecha = tieneResolverFecha ? describe : describe.skip;
const describeIfLibObligaciones = tieneLibObligaciones ? describe : describe.skip;

if (!tieneResolverFecha) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/obligaciones_mensuales.test.js] backend/lib_calculos.js no expone todavía ' +
    'resolverFechaVencimientoMensual(diaVencimiento, mes, anio) — se omiten esos tests. ' +
    'Ver la firma recomendada en la cabecera de este archivo.'
  );
}
if (!tieneLibObligaciones) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/obligaciones_mensuales.test.js] backend/lib_obligaciones.js todavía no existe ' +
    '(o no expone debeGenerarPeriodo) — se omiten esos tests. Ver la firma recomendada en ' +
    'la cabecera de este archivo.'
  );
}

describeIfResolverFecha('lib_calculos.resolverFechaVencimientoMensual — clamp al último día real del mes', () => {
  test('día 31 en febrero de un año NO bisiesto (2026) cae en 2026-02-28', () => {
    expect(libCalc.resolverFechaVencimientoMensual(31, 2, 2026)).toBe('2026-02-28');
  });

  test('día 30 en febrero de un año NO bisiesto (2026) también cae en 2026-02-28', () => {
    expect(libCalc.resolverFechaVencimientoMensual(30, 2, 2026)).toBe('2026-02-28');
  });

  test('día 29 en febrero de un año bisiesto (2024) SÍ es válido: 2024-02-29', () => {
    expect(libCalc.resolverFechaVencimientoMensual(29, 2, 2024)).toBe('2024-02-29');
  });

  test('día 29 en febrero de un año NO bisiesto (2025) cae en 2025-02-28', () => {
    expect(libCalc.resolverFechaVencimientoMensual(29, 2, 2025)).toBe('2025-02-28');
  });

  test('día 31 en abril (30 días) cae en el día 30', () => {
    expect(libCalc.resolverFechaVencimientoMensual(31, 4, 2026)).toBe('2026-04-30');
  });

  test('día 31 en un mes de 31 días no se toca', () => {
    expect(libCalc.resolverFechaVencimientoMensual(31, 1, 2026)).toBe('2026-01-31');
    expect(libCalc.resolverFechaVencimientoMensual(31, 12, 2026)).toBe('2026-12-31');
  });

  test('un día "normal" (15) nunca se ve afectado por el clamp, en ningún mes', () => {
    expect(libCalc.resolverFechaVencimientoMensual(15, 2, 2026)).toBe('2026-02-15');
    expect(libCalc.resolverFechaVencimientoMensual(15, 4, 2026)).toBe('2026-04-15');
  });
});

describeIfLibObligaciones('lib_obligaciones — idempotencia por ultimo_periodo_generado', () => {
  test('debeGenerarPeriodo es true cuando ultimo_periodo_generado está vacío (primera vez)', () => {
    expect(libObligaciones.debeGenerarPeriodo('', '2026-08')).toBe(true);
    expect(libObligaciones.debeGenerarPeriodo(null, '2026-08')).toBe(true);
  });

  test('debeGenerarPeriodo es false cuando ultimo_periodo_generado YA es el período actual', () => {
    expect(libObligaciones.debeGenerarPeriodo('2026-08', '2026-08')).toBe(false);
  });

  test('debeGenerarPeriodo es true cuando cambió el mes desde la última generación', () => {
    expect(libObligaciones.debeGenerarPeriodo('2026-07', '2026-08')).toBe(true);
  });

  test('debeGenerarPeriodo es false si la obligación ya va adelantada (cuota del mes siguiente cargada)', () => {
    expect(libObligaciones.debeGenerarPeriodo('2026-11', '2026-10')).toBe(false);
  });

  test('periodoActual extrae "yyyy-MM" de una fecha', () => {
    expect(libObligaciones.periodoActual(new Date(2026, 7, 2))).toBe('2026-08'); // agosto = mes 7 (0-idx)
    expect(libObligaciones.periodoActual('2026-08-02')).toBe('2026-08');
  });

  test('correr el trigger diez veces el mismo día genera UNA sola deuda (idempotencia real, § 4-ter)', () => {
    const obligacion = {
      id_obligacion: 'OBL_planilla',
      id_espacio: 'ESP_TELCOM',
      concepto: 'Planilla',
      dia_vencimiento: 31, // mes en curso puede no tener día 31
      monto_estimado: 5000,
      ultimo_periodo_generado: '',
      activo: true
    };

    /** Simula lo que haría generarObligacionesDelMes() por cada corrida del trigger. */
    function correrTriggerUnaVez(obligacionActual, fechaEjecucion) {
      const periodo = libObligaciones.periodoActual(fechaEjecucion);
      if (!libObligaciones.debeGenerarPeriodo(obligacionActual.ultimo_periodo_generado, periodo)) {
        return { deudaGenerada: null, obligacion: obligacionActual };
      }
      const deuda = {
        tipo: 'debo',
        persona: obligacionActual.concepto,
        monto_original: obligacionActual.monto_estimado,
        monto_pendiente: obligacionActual.monto_estimado,
        origen: 'app'
      };
      return {
        deudaGenerada: deuda,
        obligacion: Object.assign({}, obligacionActual, { ultimo_periodo_generado: periodo })
      };
    }

    const fechaEjecucion = new Date(2026, 1, 15); // 15 de febrero de 2026 (mes corto)
    let estadoObligacion = obligacion;
    const deudasGeneradas = [];

    for (let i = 0; i < 10; i++) {
      const resultado = correrTriggerUnaVez(estadoObligacion, fechaEjecucion);
      estadoObligacion = resultado.obligacion;
      if (resultado.deudaGenerada) deudasGeneradas.push(resultado.deudaGenerada);
    }

    expect(deudasGeneradas).toHaveLength(1);
    expect(estadoObligacion.ultimo_periodo_generado).toBe('2026-02');
  });
});
