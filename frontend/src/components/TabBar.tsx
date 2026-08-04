import type { Tab } from '../App';
import './TabBar.css';

interface TabBarProps {
  activo: Tab;
  onCambiar: (tab: Tab) => void;
  mostrarAdmin: boolean;
}

const ICONO_RESUMEN = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 13a8 8 0 1 1 16 0M12 13l4-4M4 20h16"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ICONO_GASTOS = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M3 10h18M7 3h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ICONO_DEUDAS = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1 3 2.5-1.3 2-3 2.5-3 1.1-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const ICONO_ADMIN = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="2" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const PESTANAS: Array<{ id: Tab; etiqueta: string; icono: JSX.Element }> = [
  { id: 'resumen', etiqueta: 'Resumen', icono: ICONO_RESUMEN },
  { id: 'gastos', etiqueta: 'Gastos', icono: ICONO_GASTOS },
  { id: 'deudas', etiqueta: 'Deudas', icono: ICONO_DEUDAS },
];

/**
 * Tab bar inferior fija, 3 secciones + Administración condicional.
 * CSS puro, respeta safe-area-inset-bottom para el notch/home indicator.
 */
export default function TabBar({ activo, onCambiar, mostrarAdmin }: TabBarProps) {
  const pestanas = mostrarAdmin
    ? [...PESTANAS, { id: 'admin' as const, etiqueta: 'Administración', icono: ICONO_ADMIN }]
    : PESTANAS;

  return (
    <nav className="tab-bar" aria-label="Navegación principal">
      {pestanas.map((p) => {
        const seleccionado = p.id === activo;
        return (
          <button
            key={p.id}
            type="button"
            className={`tab-bar__item ${seleccionado ? 'tab-bar__item--activo' : ''}`}
            onClick={() => onCambiar(p.id)}
            aria-current={seleccionado ? 'page' : undefined}
          >
            {p.icono}
            <span className="tab-bar__etiqueta">{p.etiqueta}</span>
          </button>
        );
      })}
    </nav>
  );
}
