/**
 * Préstamos bancarios — lógica PURA (CONTRACT § 4-quinquies).
 *
 * Un préstamo se materializa como una Deuda `debo` por cuota, con `id_prestamo`, `nro_cuota` y
 * el desglose capital / interés / otros (seguro de desgravamen, comisiones). Así cada cuota usa
 * todo lo que ya existe para deudas: aviso de vencimiento, pago parcial, sincronización offline.
 *
 * El cronograma que se propone es el francés (cuota fija) con TEA → TEM, como lo calculan los
 * bancos en Perú. El banco entrega su propio cronograma y casi nunca coincide al centavo
 * (cuentan días exactos, redondean distinto), por eso la UI deja corregir cada cuota antes de
 * guardar: manda el papel del banco, no esta fórmula.
 */
import type { Deuda } from './types';

export interface CuotaCronograma {
  nro: number;
  /** 'yyyy-MM-dd'. */
  fecha: string;
  cuota: number;
  capital: number;
  interes: number;
  /** Seguro de desgravamen, comisiones, portes. */
  otros: number;
  /** Saldo de capital después de pagar esta cuota. */
  saldo: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** TEA en porcentaje (18 = 18 %) → tasa efectiva mensual en fracción. */
export function temDesdeTea(teaPorcentaje: number): number {
  return Math.pow(1 + teaPorcentaje / 100, 1 / 12) - 1;
}

/** Fecha de la cuota `k` (1 = primer mes después del desembolso), recortando a fin de mes. */
export function fechaCuota(fechaDesembolso: string, diaPago: number, k: number): string {
  const [a, m] = fechaDesembolso.split('-').map(Number);
  const total = a * 12 + (m - 1) + k;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(anio, mes, 0).getDate();
  const dia = Math.min(Math.max(diaPago, 1), ultimo);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export interface DatosCronograma {
  monto: number;
  /** En porcentaje. 0 = sin interés. */
  tea: number;
  plazo: number;
  fechaDesembolso: string;
  diaPago: number;
  /** Monto fijo por cuota (seguro de desgravamen, etc.). */
  otrosMensual?: number;
}

export function cronogramaFrances(d: DatosCronograma): CuotaCronograma[] {
  const n = Math.max(1, Math.floor(d.plazo));
  const i = temDesdeTea(d.tea);
  const cuotaBase = i === 0 ? d.monto / n : (d.monto * i) / (1 - Math.pow(1 + i, -n));
  const otros = r2(d.otrosMensual ?? 0);

  const cuotas: CuotaCronograma[] = [];
  let saldo = d.monto;
  for (let k = 1; k <= n; k++) {
    const interes = r2(saldo * i);
    // La última cuota cancela exactamente lo que queda: el redondeo de las anteriores no
    // puede dejar un saldo de centavos colgando.
    const capital = k === n ? r2(saldo) : r2(cuotaBase - interes);
    saldo = r2(saldo - capital);
    cuotas.push({
      nro: k,
      fecha: fechaCuota(d.fechaDesembolso, d.diaPago, k),
      cuota: r2(capital + interes + otros),
      capital,
      interes,
      otros,
      saldo,
    });
  }
  return cuotas;
}

/**
 * Cómo se reparte un pago de cuota: primero interés y otros, después capital, que es como lo
 * aplica el banco. Tiene en cuenta lo ya pagado de esa misma cuota (pagos parciales).
 */
export function repartirPagoCuota(cuota: Pick<Deuda, 'monto_original' | 'monto_pendiente' | 'capital' | 'interes' | 'otros'>, monto: number): { capital: number; costo: number } {
  const costoTotal = r2((cuota.interes ?? 0) + (cuota.otros ?? 0));
  const yaPagado = r2(cuota.monto_original - cuota.monto_pendiente);
  const costoPendiente = Math.max(0, r2(costoTotal - yaPagado));
  const costo = r2(Math.min(monto, costoPendiente));
  return { costo, capital: r2(monto - costo) };
}

export interface ResumenPrestamo {
  cuotas_total: number;
  cuotas_pagadas: number;
  /** Capital que falta devolver (lo que se le debe al banco hoy, sin intereses futuros). */
  saldo_capital: number;
  /** Lo que falta pagar contando intereses y otros de las cuotas pendientes. */
  total_por_pagar: number;
  intereses_por_pagar: number;
  proxima: { nro: number; fecha: string; monto: number; id_deuda: string } | null;
  vencidas: number;
}

export function resumenPrestamo(cuotas: Deuda[], hoy: string): ResumenPrestamo {
  const ordenadas = [...cuotas].sort((a, b) => (a.nro_cuota ?? 0) - (b.nro_cuota ?? 0));
  const abiertas = ordenadas.filter((c) => c.estado !== 'pagada' && c.monto_pendiente > 0);

  let saldo_capital = 0;
  let intereses_por_pagar = 0;
  for (const c of abiertas) {
    const costo = (c.interes ?? 0) + (c.otros ?? 0);
    const pagado = c.monto_original - c.monto_pendiente;
    // Lo pagado de una cuota cubre primero el costo (repartirPagoCuota): el capital se toca recién después.
    const costoPendiente = Math.max(0, costo - pagado);
    intereses_por_pagar += costoPendiente;
    saldo_capital += c.monto_pendiente - costoPendiente;
  }

  const proxima = abiertas[0];
  return {
    cuotas_total: ordenadas.length,
    cuotas_pagadas: ordenadas.length - abiertas.length,
    saldo_capital: r2(saldo_capital),
    total_por_pagar: r2(abiertas.reduce((s, c) => s + c.monto_pendiente, 0)),
    intereses_por_pagar: r2(intereses_por_pagar),
    proxima: proxima
      ? { nro: proxima.nro_cuota ?? 0, fecha: proxima.fecha_vencimiento, monto: proxima.monto_pendiente, id_deuda: proxima.id_deuda }
      : null,
    vencidas: abiertas.filter((c) => c.fecha_vencimiento && c.fecha_vencimiento < hoy).length,
  };
}
