import { useDeudas } from '../data/api';
import { diasHasta } from '../design/format';
import { LOGO } from './BarraLateral';
import SelectorEspacio from './SelectorEspacio';
import { InsigniaAuditoria } from './TabBar';
import './BarraSuperiorMovil.css';

interface BarraSuperiorMovilProps {
  esPropietario: boolean;
  /** Lupa: lleva a Movimientos con el foco en la búsqueda de texto. */
  onBuscar: () => void;
  /** Campana: Auditoría para el propietario, Deudas para los miembros. */
  onCampana: () => void;
}

const ICONO_BUSCAR = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
    <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ICONO_CAMPANA = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M10 21h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Deudas vencidas o que vencen en la semana; es lo que cuenta la campana de los miembros. */
function InsigniaVencimientos() {
  const deudas = useDeudas();
  const n = (deudas ?? []).filter((d) => d.estado !== 'pagada' && d.monto_pendiente > 0 && diasHasta(d.fecha_vencimiento) <= 7).length;
  if (n === 0) return null;
  return (
    <span className="insignia-alta insignia-alta--icono" role="status" aria-label={`${n} deudas vencidas o por vencer`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

/**
 * Barra superior del móvil (DESIGN § 8.1): logo en el acento del libro, selector Familia | Telcom,
 * búsqueda y campana con contador. Solo se ve a < 768px; en web el selector vive en la barra lateral.
 */
export default function BarraSuperiorMovil({ esPropietario, onBuscar, onCampana }: BarraSuperiorMovilProps) {
  return (
    <header className="barra-superior">
      <span className="barra-superior__logo">{LOGO}</span>
      <div className="barra-superior__espacio">
        <SelectorEspacio />
      </div>
      <button type="button" className="barra-superior__boton" onClick={onBuscar} aria-label="Buscar movimientos">
        {ICONO_BUSCAR}
      </button>
      <button
        type="button"
        className="barra-superior__boton"
        onClick={onCampana}
        aria-label={esPropietario ? 'Auditoría: hallazgos del mes' : 'Deudas: vencimientos'}
      >
        <span className="barra-superior__campana">
          {ICONO_CAMPANA}
          {esPropietario ? <InsigniaAuditoria clase="insignia-alta insignia-alta--icono" /> : <InsigniaVencimientos />}
        </span>
      </button>
    </header>
  );
}
