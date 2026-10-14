import { useEffect, useMemo, useState } from 'react';
import type { Categoria } from '../data/types';
import { registrarPagoDeuda, useCuentas, useSugerencias } from '../data/api';
import type { Sugerencia, TipoSugerencia } from '../data/sugerencias';
import { formatMoneda } from '../design/format';
import type { DestinoRueda } from './RuedaCategorias';
import './HojaSugerencias.css';

/** Lo que hace falta para pagar una deuda desde la hoja de confirmación. */
export interface PagoPendiente {
  id_deuda: string;
  titulo: string;
  monto: number;
  id_categoria: string;
  urgencia?: 'vencido' | 'pronto';
  detalle?: string;
}

const ICONO: Record<TipoSugerencia, string> = { pagar: '🔔', trabajador: '👤', repetir: '↻', plantilla: '✨' };

/** Bloquea el scroll del cuerpo y cierra con Esc mientras la hoja está abierta. */
function useHojaModal(abierto: boolean, onCerrar: () => void) {
  useEffect(() => {
    if (!abierto) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', alTeclear);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', alTeclear);
    };
  }, [abierto, onCerrar]);
}

interface HojaSugerenciasProps {
  destino: DestinoRueda | null;
  onCerrar: () => void;
  /** Repetir / plantilla / trabajador / "otro gasto": abre HojaRegistro prellenada. */
  onRegistrar: (r: { categoria?: string; descripcion?: string; monto?: number; trabajador?: string }) => void;
  /** Pagar una deuda: abre la hoja de confirmación. */
  onPagar: (p: PagoPendiente) => void;
}

/**
 * "¿Qué vas a registrar?": al tocar un ícono de la rueda se proponen filas grandes con lo más
 * probable (lo que vence, trabajadores, lo ya pagado, plantillas). Si el destino es un grupo,
 * chips arriba filtran por categoría.
 */
export default function HojaSugerencias({ destino, onCerrar, onRegistrar, onPagar }: HojaSugerenciasProps) {
  const [chip, setChip] = useState<string | null>(null);
  useHojaModal(destino !== null, onCerrar);
  useEffect(() => setChip(null), [destino]);

  const categorias: Categoria[] = useMemo(() => destino?.categorias ?? [], [destino]);
  const ids = useMemo(() => (chip ? [chip] : categorias.map((c) => c.id_categoria)), [chip, categorias]);
  const sugerencias = useSugerencias(ids);

  if (!destino) return null;
  const elegida = chip ? categorias.find((c) => c.id_categoria === chip) : categorias.length === 1 ? categorias[0] : undefined;
  const nombreOtro = elegida?.nombre ?? destino.nombre;

  function tocar(s: Sugerencia) {
    if (s.tipo === 'pagar' && s.id_deuda) {
      onPagar({ id_deuda: s.id_deuda, titulo: s.titulo, monto: s.monto ?? 0, id_categoria: s.id_categoria, urgencia: s.urgencia, detalle: s.detalle });
    } else {
      onRegistrar({ categoria: s.id_categoria, descripcion: s.descripcion, monto: s.monto, trabajador: s.id_trabajador });
    }
  }

  return (
    <div className="sug__fondo" onClick={onCerrar}>
      <div className="sug" role="dialog" aria-modal="true" aria-label="¿Qué vas a registrar?" onClick={(e) => e.stopPropagation()}>
        <span className="sug__asa" aria-hidden="true" />
        <header className="sug__cabecera">
          <span className="sug__icono" style={{ ['--cat' as string]: destino.color }} aria-hidden="true">{destino.icono}</span>
          <div className="sug__titulos">
            <h2 className="u-title-3">¿Qué vas a registrar?</h2>
            <p className="u-footnote">{destino.nombre}</p>
          </div>
          <button type="button" className="sug__cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>

        {destino.esGrupo && categorias.length > 1 && (
          <div className="sug__chips" role="group" aria-label="Filtrar por categoría">
            <button type="button" className={`sug__chip ${chip === null ? 'sug__chip--activo' : ''}`} aria-pressed={chip === null} onClick={() => setChip(null)}>
              Todo
            </button>
            {categorias.map((c) => (
              <button
                key={c.id_categoria}
                type="button"
                className={`sug__chip ${chip === c.id_categoria ? 'sug__chip--activo' : ''}`}
                style={{ ['--cat' as string]: c.color }}
                aria-pressed={chip === c.id_categoria}
                onClick={() => setChip(c.id_categoria)}
              >
                <span aria-hidden="true">{c.icono}</span> {c.nombre}
              </button>
            ))}
          </div>
        )}

        <div className="sug__lista">
          {sugerencias === undefined ? (
            <div className="u-skeleton" style={{ height: 120 }} aria-hidden="true" />
          ) : (
            <ul className="sug__filas">
              {sugerencias.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`sug__fila sug__fila--${s.tipo}`} onClick={() => tocar(s)}>
                    <span className="sug__fila-icono" aria-hidden="true">{ICONO[s.tipo]}</span>
                    <span className="sug__fila-datos">
                      <span className="sug__fila-titulo">
                        {s.titulo}
                        {s.urgencia && (
                          <span className={`sug__insignia sug__insignia--${s.urgencia}`}>{s.urgencia === 'vencido' ? 'Vencido' : 'Pronto'}</span>
                        )}
                      </span>
                      <span className="sug__fila-detalle u-footnote">{s.detalle}</span>
                    </span>
                    {s.monto !== undefined && <span className="sug__fila-monto u-num">{formatMoneda(s.monto)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sug__pie">
          <button type="button" className="sug__otro" onClick={() => onRegistrar({ categoria: elegida?.id_categoria })}>
            <span aria-hidden="true">＋</span> Otro gasto en {nombreOtro}
          </button>
        </div>
      </div>
    </div>
  );
}

interface HojaPagoProps {
  pago: PagoPendiente | null;
  onCerrar: () => void;
  onPagado: () => void;
}

/** Confirmación compacta "Pagar {titulo}": monto editable (pago parcial) y cuenta. */
export function HojaPago({ pago, onCerrar, onPagado }: HojaPagoProps) {
  const cuentas = useCuentas();
  const [texto, setTexto] = useState('');
  const [idCuenta, setIdCuenta] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  useHojaModal(pago !== null, onCerrar);

  useEffect(() => {
    if (!pago) return;
    setTexto(pago.monto ? String(Math.round(pago.monto * 100) / 100) : '');
    setIdCuenta('');
    setError(undefined);
    setGuardando(false);
  }, [pago]);

  if (!pago) return null;
  const cuentaEfectiva = idCuenta || cuentas?.[0]?.id_cuenta || '';
  const monto = Number(texto.replace(',', '.'));

  async function pagar() {
    if (!pago || guardando) return;
    if (!Number.isFinite(monto) || monto <= 0) {
      setError('Ingresa un monto mayor que cero.');
      return;
    }
    if (monto > pago.monto + 0.005) {
      setError(`No puede superar lo pendiente (${formatMoneda(pago.monto)}).`);
      return;
    }
    if (!cuentaEfectiva) {
      setError('No hay una cuenta disponible.');
      return;
    }
    setGuardando(true);
    try {
      await registrarPagoDeuda(pago.id_deuda, monto, { id_categoria: pago.id_categoria, id_cuenta: cuentaEfectiva });
      try {
        navigator.vibrate?.(15);
      } catch {
        /* sin vibración */
      }
      onPagado();
    } catch {
      setGuardando(false);
      setError('No se pudo registrar el pago. Intenta de nuevo.');
    }
  }

  return (
    <div className="sug__fondo" onClick={onCerrar}>
      <div className="sug sug--pago" role="dialog" aria-modal="true" aria-label={`Pagar ${pago.titulo}`} onClick={(e) => e.stopPropagation()}>
        <span className="sug__asa" aria-hidden="true" />
        <header className="sug__cabecera">
          <span className="sug__icono" aria-hidden="true">🔔</span>
          <div className="sug__titulos">
            <h2 className="u-title-3">Pagar {pago.titulo}</h2>
            {pago.detalle && <p className="u-footnote">{pago.detalle}</p>}
          </div>
          <button type="button" className="sug__cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>

        <div className="sug__pago-cuerpo">
          <label className="sug__campo">
            <span className="u-micro">Monto (puedes pagar una parte)</span>
            <span className="sug__monto">
              <span className="sug__moneda">S/</span>
              <input
                className="sug__monto-input u-num"
                type="text"
                inputMode="decimal"
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value.replace(/[^0-9.,]/g, ''));
                  setError(undefined);
                }}
                aria-label="Monto a pagar"
              />
            </span>
          </label>
          <label className="sug__campo">
            <span className="u-micro">Pagar desde</span>
            <select className="sug__control" value={cuentaEfectiva} onChange={(e) => setIdCuenta(e.target.value)}>
              {(cuentas ?? []).map((c) => (
                <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
              ))}
            </select>
          </label>
          {error && <p className="sug__error u-footnote" role="alert">{error}</p>}
        </div>

        <div className="sug__pie">
          <button type="button" className="sug__pagar" onClick={pagar} disabled={guardando}>
            {guardando ? 'Pagando…' : 'Pagar'}
          </button>
        </div>
      </div>
    </div>
  );
}
