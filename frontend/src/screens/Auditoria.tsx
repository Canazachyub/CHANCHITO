import { useMemo, useState } from 'react';
import type { Tab } from '../App';
import { useAuditoria } from '../data/api';
import type { Destino, Hallazgo, Severidad } from '../data/auditoria';
import ilustracionCuadra from '../assets/cuadra.webp';
import SelectorEspacio from '../components/SelectorEspacio';
import { formatMoneda, nombreMesCorto } from '../design/format';
import './Auditoria.css';

interface AuditoriaProps {
  /** App es dueña de la pestaña activa: el botón "Ir a corregir" le pide cambiarla. */
  onIr: (tab: Tab) => void;
}

const SEVERIDADES: Array<{ id: Severidad; nombre: string }> = [
  { id: 'alta', nombre: 'Alta' },
  { id: 'media', nombre: 'Media' },
  { id: 'baja', nombre: 'Baja' },
];

const NOMBRE_DESTINO: Record<Destino, string> = {
  resumen: 'Resumen',
  gastos: 'Gastos',
  deudas: 'Deudas',
  tablero: 'Tablero',
  admin: 'Administración',
};

/** Lo que revisa la auditoría, en lenguaje llano. */
const REVISIONES = [
  'Controles entre hojas: que Planilla y Caja cuadren con Resultados.',
  'Pagos y deudas vencidos.',
  'Lo que vence esta semana.',
  'Contratos de personal por vencer.',
  'Datos de planilla: sueldo base, ONP/AFP y otros campos faltantes.',
  'Marcas [VERIFICAR] pendientes de confirmar.',
  'Personal sin trabajador vinculado.',
  'Movimientos duplicados.',
  'Gastos atípicos frente a la mediana de su categoría.',
  'Obligaciones mensuales sin generar.',
  'Sincronización: cambios pendientes y conflictos.',
];

function TarjetaHallazgo({ h, onIr }: { h: Hallazgo; onIr: (tab: Tab) => void }) {
  return (
    <li className={`aud-hallazgo aud-hallazgo--${h.severidad}`}>
      <span className="aud-punto" aria-hidden="true" />
      <div className="aud-hallazgo__cuerpo">
        <div className="aud-hallazgo__cabecera">
          <h3 className="aud-hallazgo__titulo">{h.titulo}</h3>
          {h.monto !== undefined && <span className="aud-hallazgo__monto u-num">{formatMoneda(h.monto)}</span>}
        </div>
        <p className="aud-hallazgo__detalle">{h.detalle}</p>
        <button type="button" className="aud-ir" onClick={() => onIr(h.destino)}>
          Ir a corregir
          <span className="aud-ir__destino">{NOMBRE_DESTINO[h.destino]}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </li>
  );
}

function Grupo({ sev, items, onIr }: { sev: Severidad; items: Hallazgo[]; onIr: (tab: Tab) => void }) {
  if (items.length === 0) return null;
  const info = SEVERIDADES.find((s) => s.id === sev)!;
  return (
    <section className="aud-grupo" aria-label={`Severidad ${info.nombre}`}>
      <h2 className={`aud-grupo__titulo aud-grupo__titulo--${sev}`}>
        <span className="aud-punto" aria-hidden="true" />
        Severidad {info.nombre}
        <span className="aud-grupo__n u-num">{items.length}</span>
      </h2>
      <ul className="aud-lista">
        {items.map((h) => (
          <TarjetaHallazgo key={h.id} h={h} onIr={onIr} />
        ))}
      </ul>
    </section>
  );
}

export default function Auditoria({ onIr }: AuditoriaProps) {
  const hoy = useMemo(() => new Date(), []);
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const hallazgos = useAuditoria(mes, anio);

  const esMesActual = mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();

  function irMesAnterior() {
    if (mes === 1) {
      setMes(12);
      setAnio((a) => a - 1);
    } else setMes((m) => m - 1);
  }

  function irMesSiguiente() {
    if (esMesActual) return;
    if (mes === 12) {
      setMes(1);
      setAnio((a) => a + 1);
    } else setMes((m) => m + 1);
  }

  const por = useMemo(() => {
    const r: Record<Severidad, Hallazgo[]> = { alta: [], media: [], baja: [] };
    for (const h of hallazgos ?? []) r[h.severidad].push(h);
    return r;
  }, [hallazgos]);

  const totalMonto = useMemo(
    () => (hallazgos ?? []).reduce((s, h) => s + (h.monto !== undefined ? Math.abs(h.monto) : 0), 0),
    [hallazgos],
  );

  return (
    <>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <div className="aud-barra">
        <div>
          <h1 className="u-title-1">Auditoría</h1>
          <p className="u-footnote aud-sub">Lo que no cuadra, lo que vence y lo que falta registrar.</p>
        </div>
        <div className="aud-mes">
          <button type="button" className="aud-flecha" onClick={irMesAnterior} aria-label="Mes anterior">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M11 3l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="u-headline aud-mes__actual">{nombreMesCorto(mes)} {anio}</span>
          <button type="button" className="aud-flecha" onClick={irMesSiguiente} disabled={esMesActual} aria-label="Mes siguiente">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M7 3l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {!hallazgos ? (
        <div aria-busy="true" aria-label="Cargando auditoría" className="aud-esqueleto">
          <div className="u-skeleton" style={{ height: 84 }} />
          <div className="u-skeleton" style={{ height: 120 }} />
          <div className="u-skeleton" style={{ height: 120 }} />
        </div>
      ) : (
        <>
          <section className="aud-resumen" aria-label="Resumen de hallazgos">
            {SEVERIDADES.map((s) => (
              <div key={s.id} className={`aud-cifra aud-cifra--${s.id}`}>
                <span className="aud-cifra__n u-num">{por[s.id].length}</span>
                <span className="aud-cifra__etq">{s.nombre}</span>
              </div>
            ))}
            <div className="aud-cifra aud-cifra--monto">
              <span className="aud-cifra__n aud-cifra__n--monto u-num">{formatMoneda(totalMonto)}</span>
              <span className="aud-cifra__etq">Total involucrado</span>
            </div>
          </section>

          {hallazgos.length === 0 ? (
            <div className="aud-vacio">
              <img className="u-estado-vacio__ilustracion" src={ilustracionCuadra} alt="" aria-hidden="true" />
              <h2 className="u-title-2 aud-vacio__titulo">Todo cuadra ✓</h2>
              <p className="u-footnote">
                Sin hallazgos en {nombreMesCorto(mes)} {anio}. Las hojas cuadran, nada vence y no falta registrar nada.
              </p>
            </div>
          ) : (
            <div className="aud-cols">
              <div className="aud-col aud-col--principal">
                <Grupo sev="alta" items={por.alta} onIr={onIr} />
                <Grupo sev="media" items={por.media} onIr={onIr} />
              </div>
              <div className="aud-col aud-col--lateral">
                <Grupo sev="baja" items={por.baja} onIr={onIr} />
                <aside className="aud-explica">
                  <h2 className="u-headline">Qué revisa la auditoría</h2>
                  <ul>
                    {REVISIONES.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </aside>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
