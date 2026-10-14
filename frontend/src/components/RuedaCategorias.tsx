import { useEffect, useMemo, useRef, useState } from 'react';
import type { Categoria } from '../data/types';
import type { ResumenRango } from '../data/api';
import { ordenarPorUso } from '../data/periodo';
import { formatMoneda } from '../design/format';
import './RuedaCategorias.css';

/** Lo que se tocó en la rueda: una categoría o un grupo con todas sus categorías. */
export interface DestinoRueda {
  nombre: string;
  icono: string;
  color: string;
  esGrupo: boolean;
  /** Categorías de gasto activas que cubre (una sola si no es grupo). */
  categorias: Categoria[];
}

interface RuedaCategoriasProps {
  resumen: ResumenRango | undefined;
  /** Categorías de gasto activas del espacio, en su orden. */
  categorias: Categoria[] | undefined;
  /** Uso en los últimos 90 días (ordena los íconos). */
  uso: Record<string, number> | undefined;
  /** Etiqueta del período para el centro ("octubre"). */
  etiqueta: string;
  /** Toque en un ícono (o en un grupo, en Telcom): abre la hoja de sugerencias de esas categorías. */
  onElegir: (destino: DestinoRueda) => void;
  /** Toque en una porción o en el centro: abre Movimientos (filtrado si hay categoría). */
  onVerMovimientos: (idCategoria?: string) => void;
}

/** Grupos de Telcom que muestra la rueda (CONTRACT § 6-bis); lo que no calza cae en 'otros'. */
const GRUPOS_RUEDA: Array<{ clave: string; nombre: string; icono: string; serie: number }> = [
  { clave: 'personal', nombre: 'Personal', icono: '👥', serie: 1 },
  { clave: 'operativos', nombre: 'Operativos', icono: '⚙️', serie: 2 },
  { clave: 'activos', nombre: 'Activos', icono: '🏗️', serie: 3 },
  { clave: 'impuestos', nombre: 'Impuestos', icono: '🧾', serie: 4 },
  { clave: 'financiero', nombre: 'Financiero', icono: '🏦', serie: 5 },
  { clave: 'otros', nombre: 'Otros', icono: '📦', serie: 6 },
];

const MAX_ICONOS = 8;

export function claveGrupo(grupo: string): string {
  return GRUPOS_RUEDA.some((g) => g.clave === grupo) ? grupo : 'otros';
}

interface Item {
  clave: string;
  nombre: string;
  icono: string;
  /** Color CSS (valor de la categoría o var(--serie-n)). */
  color: string;
  proporcion: number;
  total: number;
}

function punto(grados: number, r: number): [number, number] {
  const rad = (grados * Math.PI) / 180;
  return [50 + r * Math.sin(rad), 50 - r * Math.cos(rad)];
}

/** Arco de dona desde `a0` hasta `a1` (grados, 0 = arriba, horario). */
function trazoArco(a0: number, a1: number, r: number): string {
  const fin = Math.min(a1, a0 + 359.99);
  const [x0, y0] = punto(a0, r);
  const [x1, y1] = punto(fin, r);
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${fin - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * "Rueda de categorías" (DESIGN § 8.1-bis, referencia Monefy): dona del gasto del período con el
 * total al centro y, alrededor, 8 íconos de las categorías más usadas con su %. Un toque en un
 * ícono abre las sugerencias de esa categoría (qué pagar, qué repetir). En Telcom (categorías con
 * grupo) la rueda muestra los grupos y la hoja de sugerencias cubre todas las categorías del grupo.
 */
export default function RuedaCategorias({ resumen, categorias, uso, etiqueta, onElegir, onVerMovimientos }: RuedaCategoriasProps) {
  const [elegido, setElegido] = useState<string | null>(null);
  const [destello, setDestello] = useState<Item | null>(null);
  const temporizador = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(temporizador.current), []);

  const modoGrupos = useMemo(() => (categorias ?? []).some((c) => c.grupo && c.grupo !== 'ingresos'), [categorias]);

  const { anillo, porciones } = useMemo(() => {
    const cats = categorias ?? [];
    const gastoDe = new Map((resumen?.por_categoria ?? []).map((c) => [c.id_categoria, c]));

    if (modoGrupos) {
      const totales = new Map<string, number>();
      for (const g of resumen?.por_grupo ?? []) totales.set(claveGrupo(g.grupo), (totales.get(claveGrupo(g.grupo)) ?? 0) + g.total);
      const gastos = resumen?.gastos ?? 0;
      // Solo los grupos que tienen categorías activas en este espacio.
      const presentes = new Set(cats.map((c) => claveGrupo(c.grupo)));
      const items: Item[] = GRUPOS_RUEDA.filter((g) => presentes.has(g.clave)).map((g) => {
        const total = totales.get(g.clave) ?? 0;
        return { clave: g.clave, nombre: g.nombre, icono: g.icono, color: `var(--serie-${g.serie})`, total, proporcion: gastos > 0 ? total / gastos : 0 };
      });
      return { anillo: items, porciones: items.filter((i) => i.total > 0) };
    }

    const anillo: Item[] = ordenarPorUso(cats, uso)
      .slice(0, MAX_ICONOS)
      .map((c) => {
        const g = gastoDe.get(c.id_categoria);
        return { clave: c.id_categoria, nombre: c.nombre, icono: c.icono, color: c.color, total: g?.total ?? 0, proporcion: g?.proporcion ?? 0 };
      });
    const porciones: Item[] = (resumen?.por_categoria ?? []).map((g) => ({
      clave: g.id_categoria,
      nombre: g.nombre,
      icono: g.icono,
      color: g.color,
      total: g.total,
      proporcion: g.proporcion,
    }));
    return { anillo, porciones };
  }, [categorias, resumen, uso, modoGrupos]);

  if (categorias === undefined || resumen === undefined) {
    return <div className="u-skeleton rueda__esqueleto" aria-hidden="true" />;
  }

  // Porciones de la dona.
  let acumulado = 0;
  const holgura = porciones.length > 1 ? 1.2 : 0;
  const arcos = porciones.map((p) => {
    const a0 = acumulado * 360;
    acumulado += p.proporcion;
    return { p, d: trazoArco(a0 + holgura / 2, Math.max(a0 + holgura / 2 + 0.5, acumulado * 360 - holgura / 2), 38) };
  });

  const n = anillo.length;
  const total = formatMoneda(resumen.gastos);

  function alTocarIcono(item: Item) {
    setElegido(item.clave);
    setDestello(item);
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => {
      setDestello(null);
      setElegido(null);
    }, 1800);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* sin vibración */
    }
    const cats = modoGrupos ? (categorias ?? []).filter((c) => claveGrupo(c.grupo) === item.clave) : (categorias ?? []).filter((c) => c.id_categoria === item.clave);
    onElegir({ nombre: item.nombre, icono: item.icono, color: item.color, esGrupo: modoGrupos, categorias: cats });
  }

  return (
    <div className="rueda">
      <div className="rueda__lienzo">
        <svg className="rueda__dona" viewBox="0 0 100 100" role="img" aria-label={`Gastos de ${etiqueta}: ${total}`}>
          <circle cx="50" cy="50" r="38" className="rueda__pista" />
          {arcos.map(({ p, d }) => (
            <path
              key={p.clave}
              d={d}
              className="rueda__porcion"
              style={{ stroke: p.color }}
              role="button"
              tabIndex={0}
              aria-label={`${p.nombre}: ${pct(p.proporcion)}. Ver movimientos`}
              onClick={() => onVerMovimientos(modoGrupos ? undefined : p.clave)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onVerMovimientos(modoGrupos ? undefined : p.clave);
                }
              }}
            />
          ))}
        </svg>

        <button type="button" className="rueda__centro" onClick={() => onVerMovimientos()} aria-label={`Gastos de ${etiqueta}: ${total}. Ver movimientos`}>
          {destello ? (
            <>
              <span className={`rueda__total u-num ${formatMoneda(destello.total).length > 11 ? 'rueda__total--largo' : ''}`} style={{ color: destello.color }}>
                {formatMoneda(destello.total)}
              </span>
              <span className="rueda__leyenda">{destello.nombre}</span>
            </>
          ) : (
            <>
              <span className={`rueda__total u-num ${total.length > 11 ? 'rueda__total--largo' : ''}`}>{total}</span>
              <span className="rueda__leyenda">gastos de {etiqueta}</span>
            </>
          )}
        </button>

        {anillo.map((item, i) => {
          const grados = -90 + (i * 360) / n;
          const x = 50 + 40 * Math.cos((grados * Math.PI) / 180);
          const y = 50 + 40 * Math.sin((grados * Math.PI) / 180);
          const activo = elegido === item.clave;
          return (
            <button
              key={item.clave}
              type="button"
              className={`rueda__item ${activo ? 'rueda__item--activo' : ''}`}
              style={{ left: `${x}%`, top: `${y}%`, ['--cat' as string]: item.color }}
              onClick={() => alTocarIcono(item)}
              aria-pressed={activo}
              aria-label={
                modoGrupos
                  ? `Grupo ${item.nombre}${item.proporcion > 0 ? `, ${pct(item.proporcion)} del gasto` : ''}. Ver qué registrar`
                  : `${item.nombre}${item.proporcion > 0 ? `, ${pct(item.proporcion)} del gasto` : ''}. Ver qué registrar`
              }
            >
              <span className="rueda__icono" aria-hidden="true">{item.icono}</span>
              {item.proporcion > 0 ? (
                <span className="rueda__pct u-num">{pct(item.proporcion)}</span>
              ) : (
                <span className="rueda__nombre">{item.nombre}</span>
              )}
            </button>
          );
        })}
      </div>

      {resumen.gastos === 0 && <p className="rueda__pista-uso u-footnote">Toca un ícono para registrar tu primer gasto</p>}
    </div>
  );
}
