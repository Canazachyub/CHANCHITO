import { useRef, useState, type ReactNode } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsCoreOption } from 'echarts/core';
import echarts from './echarts';
import { NOMBRE_TEMA, registrarTema, reducirMovimiento, useTokens } from './tema';
import './graficos.css';

export interface DatosTabla {
  columnas: string[];
  filas: Array<Array<string | number>>;
}

interface BloqueGraficoProps {
  titulo: string;
  subtitulo?: string;
  /** Una línea calculada; también es el aria-label del gráfico (DESIGN § 7.2). */
  conclusion?: string;
  acciones?: ReactNode;
  children: ReactNode;
}

/** Contenedor común de un gráfico: título, período, conclusión. La clase `.tarjeta` la estiliza el sistema de bloques. */
export function BloqueGrafico({ titulo, subtitulo, conclusion, acciones, children }: BloqueGraficoProps) {
  return (
    <section className="tarjeta grafico" aria-label={titulo}>
      <header className="grafico__cabecera">
        <div className="grafico__titulos">
          <h2 className="grafico__titulo">{titulo}</h2>
          {subtitulo && <p className="grafico__subtitulo">{subtitulo}</p>}
        </div>
        {acciones && <div className="grafico__acciones">{acciones}</div>}
      </header>
      {conclusion && <p className="grafico__conclusion">{conclusion}</p>}
      {children}
    </section>
  );
}

interface GraficoProps {
  titulo: string;
  subtitulo?: string;
  conclusion?: string;
  /** undefined = cargando (esqueleto). */
  option: EChartsCoreOption | undefined;
  /** true = no hay datos que graficar. */
  vacio?: boolean;
  textoVacio?: string;
  /** Alto en px en móvil (200–240 según DESIGN § 7.3); en pantallas anchas crece un 20 %. */
  alto?: number;
  /** Si viene, se ofrece "Ver datos" con esta tabla. */
  datos?: DatosTabla;
  /** Ofrece "Compartir PNG". */
  compartir?: boolean;
  nombreArchivo?: string;
  onEvents?: Record<string, (params: { dataIndex: number; name: string }) => void>;
  /** Contenido extra bajo el gráfico (p. ej. el detalle al tocar una barra). */
  pie?: ReactNode;
  acciones?: ReactNode;
}

export default function Grafico({
  titulo,
  subtitulo,
  conclusion,
  option,
  vacio = false,
  textoVacio = 'Sin datos en este período.',
  alto = 224,
  datos,
  compartir = true,
  nombreArchivo,
  onEvents,
  pie,
  acciones,
}: GraficoProps) {
  const { tokens, firma } = useTokens();
  const ref = useRef<ReactEChartsCore>(null);
  const [verDatos, setVerDatos] = useState(false);

  // Se registra en cada render de tema nuevo; barato, y deja el tema alineado al libro activo.
  registrarTema(tokens);

  function compartirPng() {
    const inst = ref.current?.getEchartsInstance();
    if (!inst) return;
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: tokens.superficie1 });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombreArchivo ?? titulo.toLowerCase().replace(/\s+/g, '_')}.png`;
    a.click();
  }

  const hayAcciones = !vacio && option !== undefined && (compartir || datos);
  const botones = (
    <>
      {acciones}
      {hayAcciones && datos && (
        <button type="button" className="grafico__chip" aria-pressed={verDatos} onClick={() => setVerDatos((v) => !v)}>
          {verDatos ? 'Ocultar datos' : 'Ver datos'}
        </button>
      )}
      {hayAcciones && compartir && (
        <button type="button" className="grafico__chip" onClick={compartirPng}>
          Compartir PNG
        </button>
      )}
    </>
  );

  return (
    <BloqueGrafico titulo={titulo} subtitulo={subtitulo} conclusion={conclusion} acciones={botones}>
      <div style={{ ['--alto' as string]: `${alto}px` }}>
        {option === undefined ? (
          <div className="u-skeleton grafico__lienzo" aria-hidden="true" />
        ) : vacio ? (
          <div className="grafico__vacio grafico__lienzo">
            <span aria-hidden="true">📊</span>
            <p>{textoVacio}</p>
          </div>
        ) : (
          <div className="grafico__lienzo" role="img" aria-label={conclusion ?? titulo}>
            <ReactEChartsCore
              key={firma}
              ref={ref}
              echarts={echarts}
              theme={NOMBRE_TEMA}
              option={{ animation: !reducirMovimiento(), animationDuration: 600, ...option }}
              notMerge
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'canvas' }}
              onEvents={onEvents}
            />
          </div>
        )}
      </div>
      {pie}
      {verDatos && datos && (
        <div className="grafico__tabla-wrap">
          <table className="grafico__tabla">
            <thead>
              <tr>
                {datos.columnas.map((c) => (
                  <th key={c} scope="col">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((fila, i) => (
                <tr key={i}>
                  {fila.map((celda, j) => (
                    <td key={j}>{celda}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BloqueGrafico>
  );
}
