import type { ReactNode } from 'react';
import type { Tab } from '../App';
import type { Sesion } from '../data/types';
import { cerrarSesion, sincronizarAhora, useEstadoSync } from '../data/api';
import { InsigniaAuditoria } from '../components/TabBar';
import SelectorTema from '../components/SelectorTema';
import './MasMovil.css';

interface MasMovilProps {
  sesion: Sesion;
  esPropietario: boolean;
  onIr: (tab: Tab) => void;
  /** Abre la pantalla de cuenta (cambiar contraseña). */
  onCuenta: () => void;
}

const trazo = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

const ICONOS: Record<string, ReactNode> = {
  auditoria: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3Z" {...trazo} />
      <path d="M8.8 12.2l2.3 2.3 4.2-4.6" {...trazo} />
    </svg>
  ),
  tablero: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" {...trazo} />
      <path d="M3 10h18M3 15h18M9 10v10" {...trazo} />
    </svg>
  ),
  admin: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" {...trazo} />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" {...trazo} />
    </svg>
  ),
  prestamos: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10 12 4l9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" {...trazo} />
    </svg>
  ),
  cuenta: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="15" r="4" {...trazo} />
      <path d="M11 12l9-9M16 7l3 3" {...trazo} />
    </svg>
  ),
  salir: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" {...trazo} />
    </svg>
  ),
};

interface FilaProps {
  icono: ReactNode;
  etiqueta: string;
  detalle?: string;
  insignia?: ReactNode;
  peligro?: boolean;
  onClick: () => void;
}

function Fila({ icono, etiqueta, detalle, insignia, peligro, onClick }: FilaProps) {
  return (
    <li>
      <button type="button" className={`mas__fila ${peligro ? 'mas__fila--peligro' : ''}`} onClick={onClick}>
        <span className="mas__fila-icono">{icono}</span>
        <span className="mas__fila-texto">
          <span className="mas__fila-etiqueta">{etiqueta}</span>
          {detalle && <span className="u-footnote">{detalle}</span>}
        </span>
        {insignia}
        {!peligro && (
          <svg className="mas__flecha" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" {...trazo} />
          </svg>
        )}
      </button>
    </li>
  );
}

/** Menú "Más" del móvil (DESIGN § 8.1): lo que no cabe en la barra de pestañas. */
export default function MasMovil({ sesion, esPropietario, onIr, onCuenta }: MasMovilProps) {
  const sync = useEstadoSync();
  const rol = esPropietario ? 'Propietario' : 'Miembro';

  let estado = 'En línea · todo sincronizado';
  let clase = 'mas__punto--ok';
  if (!sync.enLinea) {
    estado = 'Sin conexión: se sincroniza al volver';
    clase = 'mas__punto--offline';
  } else if (sync.sincronizando) {
    estado = 'Sincronizando…';
    clase = 'mas__punto--sync';
  } else if (sync.pendientes > 0) {
    estado = `${sync.pendientes} pendiente${sync.pendientes === 1 ? '' : 's'} de sincronizar`;
    clase = 'mas__punto--sync';
  }

  return (
    <div className="mas">
      <header className="mas__perfil tarjeta">
        <span className="mas__avatar" aria-hidden="true">{sesion.usuario.nombre.trim().charAt(0).toUpperCase()}</span>
        <span className="mas__perfil-datos">
          <span className="u-title-3">{sesion.usuario.nombre}</span>
          <span className="u-footnote">{rol}</span>
        </span>
      </header>

      <section className="tarjeta mas__bloque" aria-label="Secciones">
        <ul className="mas__lista">
          {esPropietario && (
            <Fila
              icono={ICONOS.auditoria}
              etiqueta="Auditoría"
              detalle="Hallazgos del mes"
              insignia={<InsigniaAuditoria clase="insignia-alta" />}
              onClick={() => onIr('auditoria')}
            />
          )}
          {esPropietario && <Fila icono={ICONOS.tablero} etiqueta="Tablero" detalle="Hojas conectadas" onClick={() => onIr('tablero')} />}
          {esPropietario && <Fila icono={ICONOS.admin} etiqueta="Administración" detalle="Usuarios y trabajadores" onClick={() => onIr('admin')} />}
          <Fila icono={ICONOS.prestamos} etiqueta="Préstamos" detalle="Cuotas y cronogramas, en Deudas" onClick={() => onIr('deudas')} />
        </ul>
      </section>

      <section className="tarjeta mas__bloque" aria-label="Cuenta">
        <ul className="mas__lista">
          <Fila icono={ICONOS.cuenta} etiqueta="Mi cuenta" detalle="Cambiar contraseña" onClick={onCuenta} />
          <Fila icono={ICONOS.salir} etiqueta="Cerrar sesión" peligro onClick={() => void cerrarSesion()} />
        </ul>
      </section>

      <section className="tarjeta mas__bloque mas__tema" aria-label="Apariencia">
        <span className="u-micro">Apariencia</span>
        <SelectorTema />
      </section>

      <section className="tarjeta mas__bloque mas__sync" aria-label="Sincronización">
        <span className={`mas__punto ${clase}`} aria-hidden="true" />
        <span className="mas__sync-texto">
          <span className="u-micro">Sincronización</span>
          <span className="u-footnote">{estado}</span>
        </span>
        <button type="button" className="mas__sync-boton" onClick={() => void sincronizarAhora()} disabled={!sync.enLinea || sync.sincronizando}>
          Sincronizar
        </button>
      </section>
    </div>
  );
}
