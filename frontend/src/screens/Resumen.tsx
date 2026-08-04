import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Sesion } from '../data/types';
import { useResumenMensual, useTendencia } from '../data/api';
import TarjetaHero from '../components/TarjetaHero';
import AnilloProgreso from '../components/AnilloProgreso';
import SelectorEspacio from '../components/SelectorEspacio';
import { formatMoneda, nombreMesCorto } from '../design/format';
import './Resumen.css';

interface ResumenProps {
  sesion: Sesion;
}

/** Etiqueta legible por grupo de categoría (CONTRACT § 6-bis). '' es Familia (sin grupo) o la
 * categoría suelta de Telcom ("Otros gastos operativos"). */
const ETIQUETA_GRUPO: Record<string, string> = {
  operativos: 'Operativos',
  personal: 'Personal',
  activos: 'Activos fijos',
  impuestos: 'Impuestos',
  ingresos: 'Ingresos',
  '': 'Otros',
};

const ICONO_GRUPO: Record<string, string> = {
  operativos: '🛠️',
  personal: '👥',
  activos: '🗄️',
  impuestos: '🏛️',
  ingresos: '💰',
  '': '📦',
};

export default function Resumen({ sesion: _sesion }: ResumenProps) {
  const hoy = useMemo(() => new Date(), []);
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [gruposAbiertos, setGruposAbiertos] = useState<Set<string>>(new Set());

  const esMesActual = mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();

  function irMesAnterior() {
    if (mes === 1) {
      setMes(12);
      setAnio((a) => a - 1);
    } else {
      setMes((m) => m - 1);
    }
  }

  function irMesSiguiente() {
    if (esMesActual) return;
    if (mes === 12) {
      setMes(1);
      setAnio((a) => a + 1);
    } else {
      setMes((m) => m + 1);
    }
  }

  const resumen = useResumenMensual(mes, anio);

  const tendencia = useTendencia(6, mes, anio);
  const datosTendencia = useMemo(
    () =>
      (tendencia ?? []).map((punto) => ({
        etiqueta: nombreMesCorto(punto.mes),
        ingresos: punto.ingresos,
        gastos: punto.gastos,
      })),
    [tendencia],
  );
  const tendenciaLista = tendencia !== undefined;

  // Con 8 categorías (Familia) la lista plana de siempre se lee perfecto. Con ~20 (Telcom) deja
  // de serlo, así que si hay algún `grupo` no vacío se agrupa (CONTRACT § 6-bis) y cada grupo se
  // puede desplegar para ver el detalle — Familia nunca entra acá porque su `grupo` es siempre ''.
  const grupos = useMemo(() => {
    const categorias = resumen?.por_categoria ?? [];
    const hayGrupos = categorias.some((c) => c.grupo !== '');
    if (!hayGrupos) return null;

    const porGrupo = new Map<string, typeof categorias>();
    for (const cat of categorias) {
      const clave = cat.grupo;
      if (!porGrupo.has(clave)) porGrupo.set(clave, []);
      porGrupo.get(clave)!.push(cat);
    }
    return Array.from(porGrupo.entries())
      .map(([grupo, cats]) => ({
        grupo,
        categorias: [...cats].sort((a, b) => b.total - a.total),
        total: cats.reduce((s, c) => s + c.total, 0),
        proporcion: cats.reduce((s, c) => s + c.proporcion, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [resumen]);

  function alternarGrupo(grupo: string) {
    setGruposAbiertos((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(grupo)) siguiente.delete(grupo);
      else siguiente.add(grupo);
      return siguiente;
    });
  }

  return (
    <>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <div className="resumen__selector-mes">
        <button
          type="button"
          className="resumen__flecha"
          onClick={irMesAnterior}
          aria-label="Mes anterior"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M11 3l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="u-headline resumen__mes-actual">{nombreMesCorto(mes)} {anio}</span>
        <button
          type="button"
          className="resumen__flecha"
          onClick={irMesSiguiente}
          disabled={esMesActual}
          aria-label="Mes siguiente"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M7 3l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {resumen === undefined ? (
        <div className="u-skeleton" style={{ height: 176 }} aria-hidden="true" />
      ) : (
        <TarjetaHero
          mes={mes}
          anio={anio}
          saldo={resumen.saldo}
          totalIngresos={resumen.total_ingresos}
          totalGastos={resumen.total_gastos}
        />
      )}

      <section className="tarjeta resumen__categorias" aria-label="Gastos por categoría">
        <h2 className="u-title-3">Por categoría</h2>
        {resumen === undefined ? (
          <div className="resumen__categorias-esqueleto">
            <div className="u-skeleton" style={{ height: 52 }} aria-hidden="true" />
            <div className="u-skeleton" style={{ height: 52 }} aria-hidden="true" />
            <div className="u-skeleton" style={{ height: 52 }} aria-hidden="true" />
          </div>
        ) : resumen.por_categoria.length === 0 ? (
          <div className="u-estado-vacio">
            <span className="u-estado-vacio__icono">📊</span>
            <p className="u-callout">Sin gastos este mes.</p>
            <p className="u-footnote">Registra uno desde la pestaña Gastos para verlo acá.</p>
          </div>
        ) : grupos ? (
          <ul className="resumen__lista-categorias">
            {grupos.map((g) => {
              const abierto = gruposAbiertos.has(g.grupo);
              const colorGrupo = g.categorias[0]?.color ?? '#86868B';
              return (
                <li key={g.grupo || '_sin_grupo'} className="resumen__grupo">
                  <button
                    type="button"
                    className="resumen__fila-categoria resumen__fila-grupo"
                    onClick={() => alternarGrupo(g.grupo)}
                    aria-expanded={abierto}
                  >
                    <AnilloProgreso proporcion={g.proporcion} color={colorGrupo} tamano={44} grosor={5}>
                      <span aria-hidden="true">{ICONO_GRUPO[g.grupo] ?? '📦'}</span>
                    </AnilloProgreso>
                    <div className="resumen__categoria-info">
                      <span className="u-callout">{ETIQUETA_GRUPO[g.grupo] ?? g.grupo}</span>
                      <span className="u-footnote">
                        {g.categorias.length} categoría{g.categorias.length === 1 ? '' : 's'} · {Math.round(g.proporcion * 100)}%
                      </span>
                    </div>
                    <span className="u-amount u-num">{formatMoneda(g.total)}</span>
                    <svg
                      className={`resumen__chevron ${abierto ? 'resumen__chevron--abierto' : ''}`}
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {abierto && (
                    <ul className="resumen__subcategorias">
                      {g.categorias.map((cat) => (
                        <li key={cat.id_categoria} className="resumen__fila-categoria resumen__fila-categoria--sub">
                          <AnilloProgreso proporcion={cat.proporcion} color={cat.color} tamano={32} grosor={4}>
                            <span aria-hidden="true" className="resumen__icono-chico">{cat.icono}</span>
                          </AnilloProgreso>
                          <div className="resumen__categoria-info">
                            <span className="u-subhead resumen__nombre-sub">{cat.nombre}</span>
                          </div>
                          <span className="u-footnote u-num">{formatMoneda(cat.total)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="resumen__lista-categorias">
            {resumen.por_categoria.map((cat) => (
              <li key={cat.id_categoria} className="resumen__fila-categoria">
                <AnilloProgreso proporcion={cat.proporcion} color={cat.color} tamano={44} grosor={5}>
                  <span aria-hidden="true">{cat.icono}</span>
                </AnilloProgreso>
                <div className="resumen__categoria-info">
                  <span className="u-callout">{cat.nombre}</span>
                  <span className="u-footnote">{Math.round(cat.proporcion * 100)}% del total</span>
                </div>
                <span className="u-amount u-num">{formatMoneda(cat.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tarjeta resumen__tendencia" aria-label="Tendencia de los últimos 6 meses">
        <h2 className="u-title-3">Últimos 6 meses</h2>
        {!tendenciaLista ? (
          <div className="u-skeleton" style={{ height: 180 }} aria-hidden="true" />
        ) : (
          <div className="resumen__grafico">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={datosTendencia} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--separator)" />
                <XAxis
                  dataKey="etiqueta"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                />
                <YAxis hide domain={[0, 'auto']} />
                <Tooltip
                  formatter={(valor: number) => formatMoneda(valor)}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--separator)',
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                  labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
                  itemStyle={{ fontVariantNumeric: 'tabular-nums' }}
                />
                <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="var(--income)" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="gastos" name="Gastos" stroke="var(--expense)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="resumen__leyenda-grafico">
              <span className="resumen__leyenda-item"><span className="resumen__punto resumen__punto--ingreso" /> Ingresos</span>
              <span className="resumen__leyenda-item"><span className="resumen__punto resumen__punto--gasto" /> Gastos</span>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
