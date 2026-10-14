/** Constructores de `option` de ECharts para cada gráfico del catálogo (DESIGN § 7.3). Puros: reciben tokens y datos. */
import type { EChartsCoreOption } from 'echarts/core';
import { abreviar, conAlfa, degradado, posicionTooltip, tooltipMonto, type Tokens } from './tema';

const GRID = { left: 8, right: 8, top: 36, bottom: 4, containLabel: true };

const ejeY = { type: 'value' as const, axisLabel: { formatter: (v: number) => abreviar(v) } };

/** G2: saldo acumulado en área. */
export function opcionSaldo(t: Tokens, etiquetas: string[], valores: number[]): EChartsCoreOption {
  return {
    grid: { ...GRID, top: 12 },
    tooltip: { trigger: 'axis', formatter: tooltipMonto, position: posicionTooltip() },
    xAxis: { type: 'category', data: etiquetas, boundaryGap: false },
    yAxis: { ...ejeY, scale: true },
    series: [
      {
        name: 'Saldo acumulado',
        type: 'line',
        data: valores,
        lineStyle: { color: t.acento, width: 2.5 },
        itemStyle: { color: t.acento },
        areaStyle: { color: degradado(t.acento, 0.35, 0) },
        showSymbol: false,
      },
    ],
  };
}

/** G3: ingresos vs. gastos agrupados + neto en línea con eje derecho. */
export function opcionIngresosGastos(
  t: Tokens,
  etiquetas: string[],
  ingresos: number[],
  gastos: number[],
  neto: number[],
): EChartsCoreOption {
  return {
    grid: GRID,
    legend: { left: 0, top: 0, data: ['Ingresos', 'Gastos', 'Neto'] },
    tooltip: { trigger: 'axis', formatter: tooltipMonto, position: posicionTooltip() },
    xAxis: { type: 'category', data: etiquetas },
    yAxis: [
      ejeY,
      { ...ejeY, splitLine: { show: false } },
    ],
    series: [
      {
        name: 'Ingresos',
        type: 'bar',
        data: ingresos,
        barMaxWidth: 14,
        itemStyle: { color: degradado(t.ingreso, 1, 0.7), borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Gastos',
        type: 'bar',
        data: gastos,
        barMaxWidth: 14,
        itemStyle: { color: degradado(t.gasto, 1, 0.7), borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Neto',
        type: 'line',
        yAxisIndex: 1,
        data: neto,
        lineStyle: { color: t.acento, width: 2.5 },
        itemStyle: { color: t.acento },
        showSymbol: false,
      },
    ],
  };
}

/** G4: diferencia mensual, barras divergentes con el valor en la punta. */
export function opcionDiferencia(t: Tokens, etiquetas: string[], neto: number[]): EChartsCoreOption {
  return {
    grid: { ...GRID, top: 24, bottom: 8 },
    tooltip: { trigger: 'axis', formatter: tooltipMonto, position: posicionTooltip() },
    xAxis: { type: 'category', data: etiquetas, axisLabel: { margin: 12 } },
    yAxis: ejeY,
    series: [
      {
        name: 'Diferencia',
        type: 'bar',
        barMaxWidth: 18,
        data: neto.map((v) => ({
          value: v,
          itemStyle: {
            color: degradado(v >= 0 ? t.ingreso : t.gasto, v >= 0 ? 1 : 0.7, v >= 0 ? 0.7 : 1),
            borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
          },
          label: {
            show: v !== 0,
            position: v >= 0 ? 'top' : 'bottom',
            formatter: abreviar(v),
            color: t.texto2,
            fontFamily: t.fuenteMono,
            fontSize: 10,
          },
        })),
      },
    ],
  };
}

/** G5: barra radial concéntrica; el anillo exterior es la categoría mayor. `items` viene de mayor a menor. */
export function opcionRadial(
  t: Tokens,
  items: Array<{ nombre: string; proporcion: number; total: number }>,
): EChartsCoreOption {
  const orden = [...items].reverse(); // el primer elemento de un eje de radio queda en el anillo interior
  return {
    tooltip: {
      trigger: 'item',
      position: posicionTooltip(),
      formatter: (p: { data: { nombre: string; total: number; value: number } }) =>
        `${p.data.nombre}<br/><b>${new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(p.data.total)}</b> · ${p.data.value}%`,
    },
    polar: { radius: ['18%', '90%'], center: ['50%', '50%'] },
    angleAxis: { max: 100, show: false },
    radiusAxis: {
      type: 'category',
      data: orden.map((i) => `${i.nombre} ${Math.round(i.proporcion * 100)}%`),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.texto2, fontFamily: t.fuenteMono, fontSize: 10, width: 110, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        coordinateSystem: 'polar',
        roundCap: true,
        barCategoryGap: '30%',
        showBackground: true,
        backgroundStyle: { color: conAlfa(t.texto3, 0.15) },
        data: orden.map((i, k) => ({
          value: Math.round(i.proporcion * 100),
          nombre: i.nombre,
          total: i.total,
          itemStyle: { color: t.serie[(orden.length - 1 - k) % t.serie.length] },
        })),
      },
    ],
  };
}

/** G6: barras horizontales ordenadas (de mayor a menor, de arriba abajo). */
export function opcionBarrasH(
  t: Tokens,
  items: Array<{ nombre: string; total: number }>,
): EChartsCoreOption {
  return {
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'none' }, formatter: tooltipMonto, position: posicionTooltip() },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((i) => i.nombre),
      axisLabel: { color: t.texto2, fontFamily: t.fuenteUI, fontSize: 12, width: 96, overflow: 'truncate' },
    },
    series: [
      {
        name: 'Gasto',
        type: 'bar',
        barMaxWidth: 18,
        data: items.map((i, k) => ({
          value: i.total,
          itemStyle: { color: t.serie[k % t.serie.length], borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: 'right', formatter: (p: { value: number }) => abreviar(p.value), color: t.texto2, fontFamily: t.fuenteMono, fontSize: 11 },
      },
    ],
  };
}
