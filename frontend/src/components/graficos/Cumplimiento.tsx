import { BloqueGrafico } from './Grafico';
import './graficos.css';

export interface FilaCumplimiento {
  etiqueta: string;
  /** Texto ya formateado del avance, p. ej. "S/ 800.00 de S/ 1,000.00". */
  texto: string;
  /** 0..1 */
  proporcion: number;
}

/** G13: barras de cumplimiento (obligaciones pagadas, metas, planilla). */
export default function Cumplimiento({
  titulo,
  subtitulo,
  conclusion,
  filas,
}: {
  titulo: string;
  subtitulo?: string;
  conclusion?: string;
  filas: FilaCumplimiento[];
}) {
  return (
    <BloqueGrafico titulo={titulo} subtitulo={subtitulo} conclusion={conclusion}>
      <div className="cumplimiento">
        {filas.map((f) => {
          const pct = Math.round(Math.min(1, Math.max(0, f.proporcion)) * 100);
          return (
            <div key={f.etiqueta} className="cumplimiento__fila">
              <div className="cumplimiento__texto">
                <span>{f.etiqueta}</span>
                <span className="cumplimiento__monto">{f.texto}</span>
              </div>
              <div
                className="cumplimiento__pista"
                role="progressbar"
                aria-label={f.etiqueta}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <span className="cumplimiento__relleno" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </BloqueGrafico>
  );
}
