import type { Tab } from '../App';
import logoUrl from '../assets/logo.webp';
import type { Sesion } from '../data/types';
import { useEstadoSync } from '../data/api';
import SelectorEspacio from './SelectorEspacio';
import SelectorTema from './SelectorTema';
import { pestanasVisibles, InsigniaAuditoria } from './TabBar';
import './BarraLateral.css';

interface BarraLateralProps {
  sesion: Sesion;
  activo: Tab;
  onCambiar: (tab: Tab) => void;
  mostrarAdmin: boolean;
  colapsada: boolean;
  onAlternar: () => void;
  /** Abre la pantalla de cuenta (cambiar contraseña / cerrar sesión). */
  onCuenta: () => void;
}

/** Logo de la marca: chanchito de bloques (docs/disenio/logo_fg.png, generado con Codex image_gen). */
export const LOGO = <img src={logoUrl} width={32} height={32} alt="" aria-hidden="true" className="logo-marca" />;

const ICONO_COLAPSAR = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M9 4v16" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const ICONO_LLAVE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="2" />
    <path d="M11 12l9-9M16 7l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Barra lateral de web y tablet (DESIGN § 8.2–8.3): 240px con etiquetas, o riel de 72px solo
 * con íconos. En 768–1023px el CSS fuerza el riel; desde 1024px el botón alterna y la elección
 * se guarda (App.tsx). Reutiliza SelectorEspacio y las pestañas de la tab bar móvil.
 */
export default function BarraLateral({ sesion, activo, onCambiar, mostrarAdmin, colapsada, onAlternar, onCuenta }: BarraLateralProps) {
  const sync = useEstadoSync();
  const pestanas = pestanasVisibles(mostrarAdmin);

  let estado = 'En línea';
  let clase = 'barra-lateral__punto--ok';
  if (!sync.enLinea) {
    estado = 'Sin conexión';
    clase = 'barra-lateral__punto--offline';
  } else if (sync.sincronizando) {
    estado = 'Sincronizando…';
    clase = 'barra-lateral__punto--sync';
  } else if (sync.pendientes > 0) {
    estado = `${sync.pendientes} pendiente${sync.pendientes === 1 ? '' : 's'}`;
    clase = 'barra-lateral__punto--sync';
  }

  const rol = sesion.usuario.rol_global === 'propietario' ? 'Propietario' : 'Miembro';

  return (
    <aside className={`barra-lateral ${colapsada ? 'barra-lateral--colapsada' : ''}`} aria-label="Barra lateral">
      <div className="barra-lateral__marca">
        <span className="barra-lateral__logo">{LOGO}</span>
        <span className="barra-lateral__nombre">Chanchito</span>
      </div>

      <div className="barra-lateral__espacio">
        <SelectorEspacio />
      </div>

      <nav className="barra-lateral__nav" aria-label="Navegación principal">
        {pestanas.map((p) => {
          const seleccionado = p.id === activo;
          return (
            <button
              key={p.id}
              type="button"
              className={`barra-lateral__item ${seleccionado ? 'barra-lateral__item--activo' : ''}`}
              onClick={() => onCambiar(p.id)}
              aria-current={seleccionado ? 'page' : undefined}
              title={p.etiqueta}
            >
              {p.icono}
              <span className="barra-lateral__etiqueta">{p.etiqueta}</span>
              {p.id === 'auditoria' && <InsigniaAuditoria clase="insignia-alta barra-lateral__insignia" />}
            </button>
          );
        })}
      </nav>

      <div className="barra-lateral__pie">
        <div className="barra-lateral__sync" title={estado}>
          <span className={`barra-lateral__punto ${clase}`} aria-hidden="true" />
          <span className="barra-lateral__texto-pie">{estado}</span>
        </div>
        <div className="barra-lateral__usuario" title={`${sesion.usuario.nombre} · ${rol}`}>
          <span className="barra-lateral__avatar" aria-hidden="true">
            {sesion.usuario.nombre.trim().charAt(0).toUpperCase()}
          </span>
          <span className="barra-lateral__texto-pie barra-lateral__usuario-datos">
            <span className="barra-lateral__usuario-nombre">{sesion.usuario.nombre}</span>
            <span className="barra-lateral__usuario-rol">{rol}</span>
          </span>
        </div>
        <div className="barra-lateral__tema">
          <SelectorTema />
          <SelectorTema variante="compacto" />
        </div>
        <button
          type="button"
          className="barra-lateral__colapsar"
          onClick={onCuenta}
          aria-label="Cambiar contraseña"
          title="Cambiar contraseña"
        >
          {ICONO_LLAVE}
          <span className="barra-lateral__texto-pie">Cambiar contraseña</span>
        </button>
        <button
          type="button"
          className="barra-lateral__colapsar"
          onClick={onAlternar}
          aria-label={colapsada ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          aria-pressed={colapsada}
          title={colapsada ? 'Expandir' : 'Colapsar'}
        >
          {ICONO_COLAPSAR}
          <span className="barra-lateral__texto-pie">Colapsar</span>
        </button>
      </div>
    </aside>
  );
}
