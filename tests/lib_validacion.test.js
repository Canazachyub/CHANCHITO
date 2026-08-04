/**
 * Tests de backend/lib_validacion.js contra las firmas obligatorias de
 * docs/CONTRACT.md ("Firmas obligatorias de la lógica pura").
 *
 * validarMonto es el fix directo al bug que produjo los `#NUM!` en Deudas y
 * Presupuestos (README § 14): todo campo numérico se valida antes de escribir.
 */

let lib;
try {
  lib = require('../backend/lib_validacion.js');
} catch (e) {
  lib = null;
}

const describeIfExists = lib ? describe : describe.skip;

if (!lib) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/lib_validacion.test.js] backend/lib_validacion.js todavía no existe — ' +
    'se omiten los tests. Ver CONTRACT.md § "Firmas obligatorias de la lógica pura".'
  );
}

describeIfExists('lib_validacion', () => {
  describe('validarMonto', () => {
    // ---- Forma del objeto devuelto ----
    test('devuelve { valido, valor } en caso válido, con la forma exacta del contrato', () => {
      const r = lib.validarMonto(45.9);
      expect(r).toHaveProperty('valido', true);
      expect(r).toHaveProperty('valor', 45.9);
      expect(r.error).toBeUndefined();
    });

    test('devuelve { valido:false, error, detalle? } en caso inválido', () => {
      const r = lib.validarMonto('abc');
      expect(r.valido).toBe(false);
      expect(r.error).toBe('MONTO_INVALIDO');
      expect(typeof r.detalle === 'string' || r.detalle === undefined).toBe(true);
    });

    // ---- Rechaza: el caso que originó los #NUM! de la data real ----
    const invalidos = [
      ['NaN literal', NaN],
      ['null', null],
      ['undefined', undefined],
      ['string vacío', ''],
      ['string solo espacios', '   '],
      ['#NUM!', '#NUM!'],
      ['#REF!', '#REF!'],
      ['#VALUE!', '#VALUE!'],
      ['texto no numérico', 'abc'],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['negativo', -10],
      ['negativo decimal string', '-45.90'],
      ['mayor a 1e9', 1e9 + 1],
      ['objeto', { monto: 45.9 }],
      ['array', [45.9]],
      ['array vacío', []],
      ['booleano', true]
    ];

    test.each(invalidos)('rechaza: %s', (_nombre, valor) => {
      const r = lib.validarMonto(valor);
      expect(r.valido).toBe(false);
      expect(r.error).toBe('MONTO_INVALIDO');
    });

    // ---- Acepta ----
    test('acepta number 45.9', () => {
      const r = lib.validarMonto(45.9);
      expect(r.valido).toBe(true);
      expect(r.valor).toBe(45.9);
    });

    test("acepta string con punto decimal '45.90'", () => {
      const r = lib.validarMonto('45.90');
      expect(r.valido).toBe(true);
      expect(r.valor).toBeCloseTo(45.9);
    });

    test("acepta string con coma decimal '45,90' → 45.9", () => {
      const r = lib.validarMonto('45,90');
      expect(r.valido).toBe(true);
      expect(r.valor).toBeCloseTo(45.9);
    });

    test("acepta '1234.5'", () => {
      const r = lib.validarMonto('1234.5');
      expect(r.valido).toBe(true);
      expect(r.valor).toBeCloseTo(1234.5);
    });

    test('acepta 0', () => {
      const r = lib.validarMonto(0);
      expect(r.valido).toBe(true);
      expect(r.valor).toBe(0);
    });

    test('acepta exactamente el límite 1e9', () => {
      const r = lib.validarMonto(1e9);
      expect(r.valido).toBe(true);
      expect(r.valor).toBe(1e9);
    });

    test("acepta miles con punto y decimal con coma '1.234,56' → 1234.56", () => {
      const r = lib.validarMonto('1.234,56');
      expect(r.valido).toBe(true);
      expect(r.valor).toBeCloseTo(1234.56);
    });
  });

  describe('validarRequeridos', () => {
    test('válido cuando todos los campos requeridos están presentes', () => {
      const r = lib.validarRequeridos({ id_cuenta: 'CTA_1', monto: 10 }, ['id_cuenta', 'monto']);
      expect(r.valido).toBe(true);
    });

    test('inválido cuando falta un campo, con detalle indicando cuál', () => {
      const r = lib.validarRequeridos({ monto: 10 }, ['id_cuenta', 'monto']);
      expect(r.valido).toBe(false);
      expect(r.error).toBe('CAMPO_REQUERIDO');
      expect(r.detalle).toEqual(expect.stringContaining('id_cuenta'));
    });

    test('trata string vacío y null como ausentes', () => {
      expect(lib.validarRequeridos({ a: '' }, ['a']).valido).toBe(false);
      expect(lib.validarRequeridos({ a: null }, ['a']).valido).toBe(false);
      expect(lib.validarRequeridos({ a: undefined }, ['a']).valido).toBe(false);
    });

    test('acepta 0 y false como valores presentes (no confundir con ausente)', () => {
      expect(lib.validarRequeridos({ a: 0 }, ['a']).valido).toBe(true);
      expect(lib.validarRequeridos({ a: false }, ['a']).valido).toBe(true);
    });

    test('lista de campos vacía siempre es válida', () => {
      expect(lib.validarRequeridos({}, []).valido).toBe(true);
    });
  });

  describe('validarFecha', () => {
    test('acepta un objeto Date directamente (así llegan las celdas de fecha de Sheets)', () => {
      const r = lib.validarFecha(new Date(2026, 7, 2)); // mes 0-based: agosto
      expect(r.valido).toBe(true);
      expect(r.valor).toBe('2026-08-02');
    });

    test('rechaza un objeto Date inválido (Invalid Date)', () => {
      const r = lib.validarFecha(new Date('esto-no-es-una-fecha'));
      expect(r.valido).toBe(false);
      expect(r.error).toBe('FECHA_INVALIDA');
    });

    test.each([
      ['2026-08-02'],
      ['2024-02-29'], // bisiesto válido
      ['2000-01-01'],
      ['2026-12-31']
    ])('acepta formato válido: %s', (fecha) => {
      const r = lib.validarFecha(fecha);
      expect(r.valido).toBe(true);
      expect(r.valor).toBe(fecha);
    });

    test.each([
      ['fecha imposible: 30 de febrero', '2026-02-30'],
      ['fecha imposible: no bisiesto', '2025-02-29'],
      ['mes 13', '2026-13-01'],
      ['mes 00', '2026-00-05'],
      ['día 00', '2026-08-00'],
      ['formato dd/mm/yyyy', '02/08/2026'],
      ['formato incompleto', '2026-08'],
      ['texto libre', 'ayer'],
      ['vacío', ''],
      ['null', null],
      ['undefined', undefined],
      ['número', 20260802]
    ])('rechaza %s (%s)', (_nombre, valor) => {
      const r = lib.validarFecha(valor);
      expect(r.valido).toBe(false);
      expect(r.error).toBe('FECHA_INVALIDA');
    });
  });

  describe('validarTipo', () => {
    test('válido cuando el valor está en la lista de permitidos', () => {
      const r = lib.validarTipo('gasto', ['ingreso', 'gasto']);
      expect(r.valido).toBe(true);
      expect(r.valor).toBe('gasto');
    });

    test('inválido cuando el valor no está en la lista', () => {
      const r = lib.validarTipo('transferencia', ['ingreso', 'gasto']);
      expect(r.valido).toBe(false);
      expect(r.error).toBe('CAMPO_REQUERIDO');
    });

    test('inválido cuando el valor es null/undefined/vacío', () => {
      expect(lib.validarTipo(null, ['ingreso', 'gasto']).valido).toBe(false);
      expect(lib.validarTipo(undefined, ['ingreso', 'gasto']).valido).toBe(false);
      expect(lib.validarTipo('', ['ingreso', 'gasto']).valido).toBe(false);
    });
  });

  describe('esFilaCorrupta', () => {
    test('true si un campo numérico es #NUM!', () => {
      expect(lib.esFilaCorrupta({ monto: '#NUM!' }, ['monto'])).toBe(true);
    });

    test('true si un campo numérico es #REF!', () => {
      expect(lib.esFilaCorrupta({ monto_original: '#REF!' }, ['monto_original'])).toBe(true);
    });

    test('true si un campo numérico es #VALUE!', () => {
      expect(lib.esFilaCorrupta({ monto_limite: '#VALUE!' }, ['monto_limite'])).toBe(true);
    });

    test('true si un campo numérico es NaN', () => {
      expect(lib.esFilaCorrupta({ monto: NaN }, ['monto'])).toBe(true);
    });

    test('false si todos los campos numéricos son válidos', () => {
      expect(lib.esFilaCorrupta({ monto: 45.9, monto_original: 100 }, ['monto', 'monto_original'])).toBe(false);
    });

    test('revisa solo los campos indicados en camposNum, ignora el resto de la fila', () => {
      expect(lib.esFilaCorrupta({ monto: 45.9, notas: '#NUM! literal en texto libre' }, ['monto'])).toBe(false);
    });

    test('false con lista de campos numéricos vacía', () => {
      expect(lib.esFilaCorrupta({ monto: '#NUM!' }, [])).toBe(false);
    });

    test('true si un campo numérico es texto no numérico que no es un error de hoja de cálculo', () => {
      expect(lib.esFilaCorrupta({ monto: 'no-es-un-numero' }, ['monto'])).toBe(true);
    });
  });

  describe('sanearTexto', () => {
    test('recorta a maxLen', () => {
      expect(lib.sanearTexto('abcdefghij', 5)).toBe('abcde');
    });

    test('elimina caracteres de control', () => {
      const conControl = 'hola\x00\x01\x02mundo';
      const saneado = lib.sanearTexto(conControl, 100);
      expect(saneado).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
      expect(saneado).toContain('hola');
      expect(saneado).toContain('mundo');
    });

    test('preserva saltos de línea normales dentro del límite (no son de control "peligrosos" a criterio de la app) o al menos no revienta', () => {
      expect(() => lib.sanearTexto('linea1\nlinea2', 100)).not.toThrow();
    });

    test('valor no-string se convierte a string de forma segura', () => {
      expect(() => lib.sanearTexto(123, 10)).not.toThrow();
      expect(() => lib.sanearTexto(null, 10)).not.toThrow();
      expect(() => lib.sanearTexto(undefined, 10)).not.toThrow();
    });

    test('devuelve string vacío si el valor es null/undefined', () => {
      expect(lib.sanearTexto(null, 10)).toBe('');
      expect(lib.sanearTexto(undefined, 10)).toBe('');
    });
  });
});
