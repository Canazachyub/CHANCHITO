import { describe, expect, it } from 'vitest';
import { cronogramaFrances } from './prestamos';
import { tceaAproximada, tirMensual } from './tcea';

const datos = { monto: 20000, tea: 18, plazo: 24, fechaDesembolso: '2026-01-10', diaPago: 10 };

describe('tceaAproximada', () => {
  it('sin costos adicionales la TCEA coincide con la TEA', () => {
    const cuotas = cronogramaFrances(datos).map((c) => c.cuota);
    expect(tceaAproximada(datos.monto, cuotas)).toBeCloseTo(18, 1);
  });

  it('con seguro mensual la TCEA supera a la TEA', () => {
    const cuotas = cronogramaFrances({ ...datos, otrosMensual: 8.5 }).map((c) => c.cuota);
    const tcea = tceaAproximada(datos.monto, cuotas)!;
    expect(tcea).toBeGreaterThan(18.3);
    expect(tcea).toBeLessThan(25);
  });

  it('préstamo sin interés: TCEA cero', () => {
    expect(tceaAproximada(1200, Array(12).fill(100))).toBeCloseTo(0, 6);
  });

  it('devuelve null con datos inválidos o cuotas que no cubren el monto', () => {
    expect(tirMensual(0, [100])).toBeNull();
    expect(tirMensual(1000, [])).toBeNull();
    expect(tirMensual(1000, [100, 100])).toBeNull();
  });
});
