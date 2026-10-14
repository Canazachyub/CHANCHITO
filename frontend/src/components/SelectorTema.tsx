import type { ReactNode } from 'react';
import { useTema, type PreferenciaTema } from '../design/tema';
import './SelectorTema.css';

const trazo = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

const ICONOS: Record<PreferenciaTema, ReactNode> = {
  sistema: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" {...trazo} />
      <path d="M8 20h8M12 16v4" {...trazo} />
    </svg>
  ),
  claro: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" {...trazo} />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" {...trazo} />
    </svg>
  ),
  oscuro: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" {...trazo} />
    </svg>
  ),
};

const OPCIONES: { id: PreferenciaTema; etiqueta: string }[] = [
  { id: 'sistema', etiqueta: 'Sistema' },
  { id: 'claro', etiqueta: 'Claro' },
  { id: 'oscuro', etiqueta: 'Oscuro' },
];

const SIGUIENTE: Record<PreferenciaTema, PreferenciaTema> = { sistema: 'claro', claro: 'oscuro', oscuro: 'sistema' };

interface SelectorTemaProps {
  /** 'compacto' = un solo botón que rota Sistema → Claro → Oscuro (riel de la barra lateral). */
  variante?: 'segmentado' | 'compacto';
  className?: string;
}

/** Apariencia de la app: Sistema · Claro · Oscuro. Se guarda por dispositivo (design/tema.ts). */
export default function SelectorTema({ variante = 'segmentado', className = '' }: SelectorTemaProps) {
  const { preferencia, cambiar } = useTema();

  if (variante === 'compacto') {
    const actual = OPCIONES.find((o) => o.id === preferencia)!.etiqueta;
    const sig = OPCIONES.find((o) => o.id === SIGUIENTE[preferencia])!.etiqueta;
    return (
      <button
        type="button"
        className={`selector-tema-compacto ${className}`}
        onClick={() => cambiar(SIGUIENTE[preferencia])}
        aria-label={`Apariencia: ${actual}. Cambiar a ${sig}`}
        title={`Apariencia: ${actual} (clic para ${sig})`}
      >
        {ICONOS[preferencia]}
      </button>
    );
  }

  return (
    <div className={`selector-tema ${className}`} role="radiogroup" aria-label="Apariencia">
      {OPCIONES.map((o) => {
        const activo = o.id === preferencia;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={activo}
            className={`selector-tema__opcion ${activo ? 'selector-tema__opcion--activo' : ''}`}
            onClick={() => cambiar(o.id)}
          >
            {ICONOS[o.id]}
            <span>{o.etiqueta}</span>
          </button>
        );
      })}
    </div>
  );
}
