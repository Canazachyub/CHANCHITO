import { useState, type ReactNode } from 'react';
import './graficos.css';

export interface ItemRanking {
  id: string;
  nombre: string;
  /** Texto ya formateado del monto. */
  monto: string;
  detalle?: ReactNode;
  /** 0..1, largo de la mini barra relativa al primero. */
  proporcion: number;
}

/** G10: ranking con medalla numerada. Muestra el top 5 y el resto bajo "Ver todos". */
export default function Ranking({ items, tope = 5 }: { items: ItemRanking[]; tope?: number }) {
  const [todos, setTodos] = useState(false);
  const visibles = todos ? items : items.slice(0, tope);
  return (
    <>
      <ol className="ranking">
        {visibles.map((it, i) => (
          <li key={it.id} className="ranking__fila">
            <span className={`ranking__medalla ranking__medalla--${i + 1}`} aria-label={`Puesto ${i + 1}`}>
              {i + 1}
            </span>
            <div className="ranking__info">
              <span className="ranking__nombre">{it.nombre}</span>
              {it.detalle && <span className="ranking__detalle">{it.detalle}</span>}
              <span className="ranking__barra" aria-hidden="true">
                <span style={{ width: `${Math.round(Math.min(1, it.proporcion) * 100)}%` }} />
              </span>
            </div>
            <span className="ranking__monto">{it.monto}</span>
          </li>
        ))}
      </ol>
      {items.length > tope && (
        <button type="button" className="grafico__chip" onClick={() => setTodos((v) => !v)} style={{ alignSelf: 'flex-start' }}>
          {todos ? 'Ver menos' : `Ver todos (${items.length})`}
        </button>
      )}
    </>
  );
}
