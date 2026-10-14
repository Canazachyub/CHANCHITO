import ReactEChartsCore from 'echarts-for-react/lib/core';
import echarts from './echarts';
import { conAlfa, degradado, reducirMovimiento, useTokens } from './tema';
import './graficos.css';

interface KpiTileProps {
  rotulo: string;
  /** Texto ya formateado del valor (S/ 1,234.00 o 32 %). */
  valor: string;
  /** Color del valor y de la sparkline. */
  color?: string;
  /** Texto del delta ya formateado, sin flecha (p. ej. "12 %"). null = sin base de comparación. */
  delta: string | null;
  /** Dirección del cambio; define la flecha. */
  sube?: boolean;
  /** Si el cambio es bueno (verde) o malo (rojo). null = neutro. */
  bueno?: boolean | null;
  /** Texto de la comparación, p. ej. "vs. mes anterior". */
  comparado?: string;
  /** Últimos puntos para la mini línea. */
  serie: number[];
  cargando?: boolean;
}

export default function KpiTile({
  rotulo,
  valor,
  color,
  delta,
  sube = true,
  bueno = null,
  comparado = 'vs. mes anterior',
  serie,
  cargando = false,
}: KpiTileProps) {
  const { tokens, firma } = useTokens();
  const colorSerie = color ?? tokens.acento;
  const claseDelta = bueno === null ? '' : bueno ? 'kpi__delta--bueno' : 'kpi__delta--malo';

  if (cargando) return <div className="kpi u-skeleton" style={{ minHeight: 112 }} aria-hidden="true" />;

  return (
    <div className="kpi">
      <span className="kpi__rotulo">{rotulo}</span>
      <span className="kpi__valor" style={{ color: colorSerie }}>{valor}</span>
      <span className={`kpi__delta ${claseDelta}`}>
        {delta === null ? (
          <span className="kpi__comparado">Sin comparación</span>
        ) : (
          <>
            <span aria-hidden="true">{sube ? '▲' : '▼'}</span>
            <span className="visually-hidden">{sube ? 'Subió' : 'Bajó'}</span> {delta}
            <span className="kpi__comparado"> {comparado}</span>
          </>
        )}
      </span>
      <div className="kpi__spark" aria-hidden="true">
        <ReactEChartsCore
          key={firma}
          echarts={echarts}
          option={{
            animation: !reducirMovimiento(),
            animationDuration: 600,
            grid: { left: 2, right: 2, top: 4, bottom: 2 },
            xAxis: { type: 'category', show: false, boundaryGap: false, data: serie.map((_, i) => i) },
            yAxis: { type: 'value', show: false, scale: true },
            tooltip: { show: false },
            series: [
              {
                type: 'line',
                data: serie,
                smooth: true,
                symbol: 'none',
                silent: true,
                lineStyle: { width: 2, color: colorSerie },
                areaStyle: { color: degradado(colorSerie, 0.35, 0) },
                itemStyle: { color: conAlfa(colorSerie, 1) },
              },
            ],
          }}
          notMerge
          style={{ height: 36, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}
