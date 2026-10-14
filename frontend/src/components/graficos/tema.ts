/**
 * Tema 'chanchito' de ECharts (DESIGN.md § 7.2). Los colores se leen de las variables CSS en
 * tiempo de ejecución para que el acento siga al libro activo (html[data-libro]); si una variable
 * todavía no existe se cae al valor de DESIGN.md.
 */
import { useMemo, useSyncExternalStore } from 'react';
import echarts from './echarts';

export const SERIE_BASE = [
  '#22D3EE', '#FFA53D', '#8B5CF6', '#3DFFA2', '#FF4D6D', '#4D8DFF', '#FFE14D', '#EC4899', '#2DD4BF', '#A3A3A3',
];

export interface Tokens {
  acento: string;
  ingreso: string;
  gasto: string;
  texto: string;
  texto2: string;
  texto3: string;
  linea: string;
  lineaFuerte: string;
  superficie1: string;
  superficie2: string;
  superficie3: string;
  serie: string[];
  fuenteMono: string;
  fuenteUI: string;
}

function css(estilo: CSSStyleDeclaration, nombres: string[], respaldo: string): string {
  for (const n of nombres) {
    const v = estilo.getPropertyValue(n).trim();
    if (v) return v;
  }
  return respaldo;
}

export function leerTokens(): Tokens {
  const estilo = getComputedStyle(document.documentElement);
  return {
    acento: css(estilo, ['--accent'], '#22D3EE'),
    ingreso: css(estilo, ['--income'], '#3DFFA2'),
    gasto: css(estilo, ['--expense'], '#FF4D6D'),
    texto: css(estilo, ['--text'], '#F2F4F8'),
    texto2: css(estilo, ['--text-2', '--text-secondary'], '#9AA3B5'),
    texto3: css(estilo, ['--text-3'], '#5D6577'),
    linea: css(estilo, ['--line', '--separator'], 'rgba(255,255,255,0.08)'),
    lineaFuerte: css(estilo, ['--line-strong'], 'rgba(255,255,255,0.16)'),
    superficie1: css(estilo, ['--surface-1', '--surface'], '#0D0F14'),
    superficie2: css(estilo, ['--surface-2'], '#141720'),
    superficie3: css(estilo, ['--surface-3', '--surface'], '#1C2030'),
    serie: SERIE_BASE.map((def, i) => css(estilo, [`--serie-${i + 1}`], def)),
    fuenteMono: css(estilo, ['--font-mono'], '"JetBrains Mono", ui-monospace, monospace'),
    fuenteUI: css(estilo, ['--font-ui', '--font-sans'], 'Inter, system-ui, sans-serif'),
  };
}

/** Firma barata del tema activo: cambia cuando cambia el libro o el modo, y dispara el re-render. */
function firmaTema(): string {
  const el = document.documentElement;
  return [el.getAttribute('data-libro'), el.getAttribute('data-tema'), getComputedStyle(el).getPropertyValue('--accent')].join('|');
}

function suscribir(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-libro', 'data-tema', 'class', 'style'] });
  return () => obs.disconnect();
}

/** Tokens vigentes; se recalculan al cambiar de libro. `firma` sirve de `key` para re-montar los gráficos. */
export function useTokens(): { tokens: Tokens; firma: string } {
  const firma = useSyncExternalStore(suscribir, firmaTema, () => '');
  const tokens = useMemo(() => leerTokens(), [firma]); // eslint-disable-line react-hooks/exhaustive-deps
  return { tokens, firma };
}

export const NOMBRE_TEMA = 'chanchito';

export function registrarTema(t: Tokens): void {
  const mono = { color: t.texto3, fontFamily: t.fuenteMono, fontSize: 11 };
  echarts.registerTheme(NOMBRE_TEMA, {
    color: t.serie,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: t.fuenteUI, color: t.texto2 },
    categoryAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: mono,
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: mono,
      splitLine: { show: true, lineStyle: { color: t.linea, type: 'dashed' } },
    },
    legend: { textStyle: { color: t.texto2, fontFamily: t.fuenteUI, fontSize: 12 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
    tooltip: {
      backgroundColor: t.superficie3,
      borderColor: t.lineaFuerte,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.texto, fontFamily: t.fuenteMono, fontSize: 12 },
      extraCssText: 'border-radius:10px;box-shadow:none;',
    },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] } },
    line: { smooth: true, symbol: 'none', lineStyle: { width: 2.5 } },
  });
}

// ---------------------------------------------------------------------------------------------
// Utilidades compartidas por las opciones de cada gráfico.

/** '#rrggbb' / '#rgb' / 'rgb(...)' con alfa; cualquier otro formato se devuelve igual. */
export function conAlfa(color: string, alfa: number): string {
  const c = color.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim());
    return `rgba(${r},${g},${b},${alfa})`;
  }
  return c;
}

/** Degradado vertical de un color: del alfa `desde` arriba al alfa `hasta` abajo. */
export function degradado(color: string, desde: number, hasta: number) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: conAlfa(color, desde) },
    { offset: 1, color: conAlfa(color, hasta) },
  ]);
}

/** 12400 → 12.4k, −3200 → −3.2k. Para ejes; el tooltip siempre muestra el monto completo. */
export function abreviar(n: number): string {
  const abs = Math.abs(n);
  const signo = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${signo}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1000) return `${signo}${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${signo}${Math.round(abs)}`;
}

export function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const moneda = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });

/** Tooltip de eje: cabecera con la categoría y una fila por serie con monto completo en Mono. */
export function tooltipMonto(params: unknown): string {
  const lista = (Array.isArray(params) ? params : [params]) as Array<{
    axisValueLabel?: string;
    name?: string;
    marker?: string;
    seriesName?: string;
    value?: unknown;
  }>;
  if (lista.length === 0) return '';
  const cab = escapar(String(lista[0].axisValueLabel ?? lista[0].name ?? ''));
  const filas = lista
    .map((p) => {
      const v = Array.isArray(p.value) ? Number(p.value[p.value.length - 1]) : Number(p.value);
      return `<div style="display:flex;justify-content:space-between;gap:16px">` +
        `<span>${p.marker ?? ''}${escapar(p.seriesName ?? '')}</span><b>${moneda.format(v).replace('-', '−')}</b></div>`;
    })
    .join('');
  return `<div style="margin-bottom:4px;opacity:.7">${cab}</div>${filas}`;
}

/** En pantallas táctiles el tooltip se fija abajo del gráfico para no quedar bajo el dedo. */
export function posicionTooltip() {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return undefined;
  return (_p: unknown, _d: unknown, _el: unknown, _r: unknown, tam: { viewSize: number[]; contentSize: number[] }) => [
    (tam.viewSize[0] - tam.contentSize[0]) / 2,
    tam.viewSize[1] - tam.contentSize[1] - 2,
  ];
}

export function reducirMovimiento(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
