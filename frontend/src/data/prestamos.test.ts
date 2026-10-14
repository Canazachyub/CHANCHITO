import { describe, expect, it } from 'vitest';
import type { Deuda } from './types';
import { cronogramaFrances, fechaCuota, repartirPagoCuota, resumenPrestamo, temDesdeTea } from './prestamos';

describe('temDesdeTea', () => {
  it('convierte TEA a TEM compuesta, no dividiendo entre 12', () => {
    expect(temDesdeTea(12.6825)).toBeCloseTo(0.01, 6);
    expect(temDesdeTea(0)).toBe(0);
  });
});

describe('fechaCuota', () => {
  it('avanza mes a mes y recorta el día a fin de mes', () => {
    expect(fechaCuota('2026-01-15', 31, 1)).toBe('2026-02-28');
    expect(fechaCuota('2026-11-20', 10, 2)).toBe('2027-01-10');
  });
});

describe('cronogramaFrances', () => {
  const c = cronogramaFrances({ monto: 10000, tea: 18, plazo: 12, fechaDesembolso: '2026-10-05', diaPago: 5, otrosMensual: 8.5 });

  it('tiene cuota fija, salvo el ajuste de la última', () => {
    expect(c).toHaveLength(12);
    const cuotas = new Set(c.slice(0, -1).map((x) => x.cuota));
    expect(cuotas.size).toBe(1);
    expect(Math.abs(c[11].cuota - c[0].cuota)).toBeLessThan(0.05);
  });

  it('devuelve exactamente el capital y termina en saldo 0', () => {
    const capital = c.reduce((s, x) => s + x.capital, 0);
    expect(Math.round(capital * 100) / 100).toBe(10000);
    expect(c[11].saldo).toBe(0);
  });

  it('el interés baja y el capital sube cuota a cuota; seguro incluido en la cuota', () => {
    expect(c[0].interes).toBeGreaterThan(c[5].interes);
    expect(c[0].capital).toBeLessThan(c[5].capital);
    expect(c[0].cuota).toBeCloseTo(c[0].capital + c[0].interes + 8.5, 2);
    expect(c[0].fecha).toBe('2026-11-05');
  });

  it('sin interés reparte el capital en partes iguales', () => {
    const s = cronogramaFrances({ monto: 1200, tea: 0, plazo: 4, fechaDesembolso: '2026-10-01', diaPago: 1 });
    expect(s.map((x) => x.capital)).toEqual([300, 300, 300, 300]);
  });
});

const cuota = (p: Partial<Deuda>): Deuda =>
  ({
    id_deuda: `DDA_${p.nro_cuota}`, tipo: 'debo', estado: 'pendiente', monto_original: 510, monto_pendiente: 510,
    capital: 400, interes: 100, otros: 10, fecha_vencimiento: '2026-11-05', eliminado: false, ...p,
  }) as Deuda;

describe('repartirPagoCuota', () => {
  it('aplica primero a interés y otros, después a capital', () => {
    expect(repartirPagoCuota(cuota({}), 510)).toEqual({ costo: 110, capital: 400 });
    expect(repartirPagoCuota(cuota({}), 50)).toEqual({ costo: 50, capital: 0 });
  });

  it('respeta lo ya pagado de la cuota en pagos anteriores', () => {
    // Ya se pagaron 80: falta 30 de costo, el resto de este pago es capital.
    expect(repartirPagoCuota(cuota({ monto_pendiente: 430 }), 430)).toEqual({ costo: 30, capital: 400 });
  });
});

describe('resumenPrestamo', () => {
  it('separa capital de intereses pendientes y encuentra la próxima cuota', () => {
    const cuotas = [
      cuota({ nro_cuota: 1, estado: 'pagada', monto_pendiente: 0, fecha_vencimiento: '2026-09-05' }),
      cuota({ nro_cuota: 2, monto_pendiente: 430, fecha_vencimiento: '2026-10-05' }),
      cuota({ nro_cuota: 3, fecha_vencimiento: '2026-11-05' }),
    ];
    const r = resumenPrestamo(cuotas, '2026-10-14');
    expect(r).toMatchObject({ cuotas_total: 3, cuotas_pagadas: 1, vencidas: 1, total_por_pagar: 940 });
    expect(r.saldo_capital).toBe(800);
    expect(r.intereses_por_pagar).toBe(140);
    expect(r.proxima).toMatchObject({ nro: 2, monto: 430 });
  });
});
