import { describe, expect, it } from 'vitest';
import { enRango, fechaYmd, mover, ordenarPorUso, rangoDe } from './periodo';

const HOY = new Date(2026, 9, 14); // 14 oct 2026

describe('rangoDe', () => {
  it('día: desde = hasta', () => {
    const r = rangoDe('dia', new Date(2026, 9, 14), HOY);
    expect(r).toEqual({ desde: '2026-10-14', hasta: '2026-10-14', etiqueta: '14 oct' });
  });

  it('semana empieza el lunes (miércoles 14 oct 2026 → 12–18)', () => {
    const r = rangoDe('semana', new Date(2026, 9, 14), HOY);
    expect(r.desde).toBe('2026-10-12');
    expect(r.hasta).toBe('2026-10-18');
    expect(r.etiqueta).toBe('12–18 oct');
  });

  it('semana: un domingo pertenece a la semana que termina en él', () => {
    const r = rangoDe('semana', new Date(2026, 9, 18), HOY);
    expect(r.desde).toBe('2026-10-12');
    expect(r.hasta).toBe('2026-10-18');
  });

  it('semana: un lunes abre su propia semana', () => {
    const r = rangoDe('semana', new Date(2026, 9, 12), HOY);
    expect(r.desde).toBe('2026-10-12');
  });

  it('semana que cruza de mes y de año', () => {
    const r = rangoDe('semana', new Date(2026, 11, 31), HOY); // jueves 31 dic 2026
    expect(r.desde).toBe('2026-12-28');
    expect(r.hasta).toBe('2027-01-03');
    expect(r.etiqueta).toBe('28 dic – 3 ene');
  });

  it('mes: primer y último día', () => {
    const r = rangoDe('mes', new Date(2026, 9, 14), HOY);
    expect(r).toEqual({ desde: '2026-10-01', hasta: '2026-10-31', etiqueta: 'octubre' });
  });

  it('mes: febrero de año bisiesto y no bisiesto', () => {
    expect(rangoDe('mes', new Date(2028, 1, 10), HOY).hasta).toBe('2028-02-29');
    expect(rangoDe('mes', new Date(2026, 1, 10), HOY).hasta).toBe('2026-02-28');
    expect(rangoDe('mes', new Date(2100, 1, 10), HOY).hasta).toBe('2100-02-28'); // 2100 no es bisiesto
  });

  it('mes de otro año lleva el año en la etiqueta', () => {
    expect(rangoDe('mes', new Date(2025, 11, 5), HOY).etiqueta).toBe('diciembre 2025');
  });

  it('año', () => {
    expect(rangoDe('anio', new Date(2026, 5, 1), HOY)).toEqual({ desde: '2026-01-01', hasta: '2026-12-31', etiqueta: '2026' });
  });
});

describe('mover', () => {
  it('día y semana', () => {
    expect(fechaYmd(mover('dia', new Date(2026, 9, 1), -1))).toBe('2026-09-30');
    expect(fechaYmd(mover('semana', new Date(2026, 9, 14), 1))).toBe('2026-10-21');
    expect(fechaYmd(mover('semana', new Date(2026, 0, 3), -1))).toBe('2025-12-27');
  });

  it('mes: cruza de año y recorta el día', () => {
    expect(fechaYmd(mover('mes', new Date(2026, 0, 15), -1))).toBe('2025-12-15');
    expect(fechaYmd(mover('mes', new Date(2026, 11, 15), 1))).toBe('2027-01-15');
    expect(fechaYmd(mover('mes', new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    expect(fechaYmd(mover('mes', new Date(2028, 0, 31), 1))).toBe('2028-02-29');
  });

  it('año: 29 de febrero cae a 28 en año no bisiesto', () => {
    expect(fechaYmd(mover('anio', new Date(2028, 1, 29), 1))).toBe('2029-02-28');
    expect(fechaYmd(mover('anio', new Date(2028, 1, 29), -4))).toBe('2024-02-29');
  });

  it('ir y volver da el mismo período', () => {
    const a = new Date(2026, 9, 14);
    for (const tipo of ['dia', 'semana', 'mes', 'anio'] as const) {
      expect(rangoDe(tipo, mover(tipo, mover(tipo, a, 1), -1), HOY)).toEqual(rangoDe(tipo, a, HOY));
    }
  });
});

describe('enRango / fechaYmd', () => {
  it('incluye ambos extremos', () => {
    const r = { desde: '2026-10-01', hasta: '2026-10-31' };
    expect(enRango('2026-10-01', r)).toBe(true);
    expect(enRango('2026-10-31', r)).toBe(true);
    expect(enRango('2026-11-01', r)).toBe(false);
    expect(enRango('2026-09-30', r)).toBe(false);
  });

  it('fechaYmd usa la fecha local con ceros', () => {
    expect(fechaYmd(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('ordenarPorUso', () => {
  const cats = [{ id_categoria: 'a' }, { id_categoria: 'b' }, { id_categoria: 'c' }, { id_categoria: 'd' }];

  it('más usadas primero y desempata por orden original', () => {
    const r = ordenarPorUso(cats, { c: 5, b: 2, d: 2 });
    expect(r.map((x) => x.id_categoria)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('sin uso conserva el orden y no muta la entrada', () => {
    expect(ordenarPorUso(cats, undefined)).toEqual(cats);
    expect(ordenarPorUso(cats, {})).not.toBe(cats);
  });
});
