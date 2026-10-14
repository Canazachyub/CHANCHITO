import type { Tab } from '../App';
import { useAuditoria } from '../data/api';
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

const ICONO_TABLERO = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M3 10h18M3 15h18M9 10v10" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const ICONO_AUDITORIA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M8.8 12.2l2.3 2.3 4.2-4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

/** Pestañas visibles según el rol; las comparten la tab bar (móvil) y la barra lateral (web). */
export function pestanasVisibles(mostrarAdmin: boolean): Array<{ id: Tab; etiqueta: string; icono: JSX.Element }> {
  return mostrarAdmin
    ? [PESTANAS[0], { id: 'auditoria' as const, etiqueta: 'Auditoría', icono: ICONO_AUDITORIA }, ...PESTANAS.slice(1), { id: 'tablero' as const, etiqueta: 'Tablero', icono: ICONO_TABLERO }, { id: 'admin' as const, etiqueta: 'Administración', icono: ICONO_ADMIN }]
    : PESTANAS;
}

/** Insignia roja con la cantidad de hallazgos 'alta' del mes actual; no se pinta si no hay. */
export function InsigniaAuditoria({ clase }: { clase: string }) {
  const hoy = new Date();
  const hallazgos = useAuditoria(hoy.getMonth() + 1, hoy.getFullYear());
  const altas = hallazgos?.filter((h) => h.severidad === 'alta').length ?? 0;
  if (altas === 0) return null;
  return (
    <span className={clase} role="status" aria-label={`${altas} hallazgos de severidad alta`}>
      {altas > 99 ? '99+' : altas}
    </span>
  );
}

const ICONO_INICIO = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 11.5 12 4l8 7.5V20h-5v-5.5H9V20H4v-8.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

const ICONO_MOVIMIENTOS = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="4.5" cy="6" r="1.3" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1.3" fill="currentColor" />
  </svg>
);

const ICONO_MAS = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
  </svg>
);

/** Las 5 pestañas del móvil (DESIGN § 8.1). Auditoría, Tablero y Administración viven dentro de Más. */
const PESTANAS_MOVIL: Array<{ id: Tab; etiqueta: string; icono: JSX.Element }> = [
  { id: 'inicio', etiqueta: 'Inicio', icono: ICONO_INICIO },
  { id: 'gastos', etiqueta: 'Movimientos', icono: ICONO_MOVIMIENTOS },
  { id: 'resumen', etiqueta: 'Análisis', icono: ICONO_RESUMEN },
  { id: 'deudas', etiqueta: 'Deudas', icono: ICONO_DEUDAS },
  { id: 'mas', etiqueta: 'Más', icono: ICONO_MAS },
];

/** Pantallas que cuelgan del menú Más: en la barra inferior se marca "Más" mientras se está en ellas. */
const DENTRO_DE_MAS: Tab[] = ['mas', 'auditoria', 'tablero', 'admin'];

/**
 * Tab bar inferior fija del móvil: Inicio · Movimientos · Análisis · Deudas · Más.
 * CSS puro, respeta safe-area-inset-bottom para el notch/home indicator. En ≥768px se oculta
 * (la navegación vive en la barra lateral, que usa pestanasVisibles).
 */
export default function TabBar({ activo, onCambiar, mostrarAdmin }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Navegación principal">
      {PESTANAS_MOVIL.map((p) => {
        const seleccionado = p.id === 'mas' ? DENTRO_DE_MAS.includes(activo) : p.id === activo;
        return (
          <button
            key={p.id}
            type="button"
            className={`tab-bar__item ${seleccionado ? 'tab-bar__item--activo' : ''}`}
            onClick={() => onCambiar(p.id)}
            aria-current={seleccionado ? 'page' : undefined}
          >
            <span className="tab-bar__icono">
              {p.icono}
              {p.id === 'mas' && mostrarAdmin && <InsigniaAuditoria clase="insignia-alta insignia-alta--icono" />}
            </span>
            <span className="tab-bar__etiqueta">{p.etiqueta}</span>
          </button>
        );
      })}
    </nav>
  );
}
