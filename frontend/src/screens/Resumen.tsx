import { useMemo, useState } from 'react';
import type { Sesion } from '../data/types';
import { useAnalisisMes, useResumenMensual, useSerieMensual } from '../data/api';
import SelectorEspacio from '../components/SelectorEspacio';
import Grafico from '../components/graficos/Grafico';
import Cumplimiento from '../components/graficos/Cumplimiento';
import KpiTile from '../components/graficos/KpiTile';
import { useTokens } from '../components/graficos/tema';
import {
  opcionBarrasH,
  opcionDiferencia,
  opcionIngresosGastos,
  opcionRadial,
  opcionSaldo,
} from '../components/graficos/opciones';
import ResumenAnalisis from './ResumenAnalisis';
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

const MESES_SERIE = 12;
/** Más anillos que esto no se leen en un radial: el resto se junta en "Otras". */
const MAX_ANILLOS = 6;

const pct = (n: number) => `${Math.round(n * 100)} %`;
const signo = (n: number) => (n < 0 ? '−' : '');

/** Cambio relativo contra la base; null si la base es 0 (no hay contra qué comparar). */
function cambioRelativo(actual: number, previo: number): number | null {
  return previo === 0 ? null : (actual - previo) / Math.abs(previo);
}

export default function Resumen({ sesion: _sesion }: ResumenProps) {
  const hoy = useMemo(() => new Date(), []);
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  const { tokens: t } = useTokens();

  const esMesActual = mes === hoy.getMonth() + 1 && anio === hoy.getFullYear();

  function irMesAnterior() {
    setGrupoSel(null);
    if (mes === 1) {
      setMes(12);
      setAnio((a) => a - 1);
    } else {
      setMes((m) => m - 1);
    }
  }

  function irMesSiguiente() {
    if (esMesActual) return;
    setGrupoSel(null);
    if (mes === 12) {
      setMes(1);
      setAnio((a) => a + 1);
    } else {
      setMes((m) => m + 1);
    }
  }

  const resumen = useResumenMensual(mes, anio);
  const serie = useSerieMensual(MESES_SERIE, mes, anio);
  const analisis = useAnalisisMes(mes, anio);

  // Con 8 categorías (Familia) un radial se lee perfecto. Con ~20 (Telcom) no, así que si hay algún
  // `grupo` no vacío se agrupa (CONTRACT § 6-bis) y cada grupo se abre al tocar su barra — Familia
  // nunca entra acá porque su `grupo` es siempre ''.
  const grupos = useMemo(() => {
    const categorias = resumen?.por_categoria ?? [];
    if (!categorias.some((c) => c.grupo !== '')) return null;
    const porGrupo = new Map<string, typeof categorias>();
    for (const cat of categorias) {
      if (!porGrupo.has(cat.grupo)) porGrupo.set(cat.grupo, []);
      porGrupo.get(cat.grupo)!.push(cat);
    }
    return Array.from(porGrupo.entries())
      .map(([grupo, cats]) => ({
        grupo,
        nombre: ETIQUETA_GRUPO[grupo] ?? grupo,
        categorias: [...cats].sort((a, b) => b.total - a.total),
        total: cats.reduce((s, c) => s + c.total, 0),
        proporcion: cats.reduce((s, c) => s + c.proporcion, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [resumen]);

  const etiquetas = useMemo(() => (serie ?? []).map((p) => nombreMesCorto(p.mes)), [serie]);
  const periodo = serie
    ? `${nombreMesCorto(serie[0].mes)} ${serie[0].anio} – ${nombreMesCorto(serie[serie.length - 1].mes)} ${serie[serie.length - 1].anio}`
    : '';
  const sinMovimientos = !!serie && serie.every((p) => p.ingresos === 0 && p.gastos === 0);

  // ---------------------------------------------------------------- G1: KPIs
  const kpis = useMemo(() => {
    if (!serie) return null;
    const ult = serie.slice(-6);
    const ahorro = (p: { ingresos: number; neto: number }) => (p.ingresos > 0 ? p.neto / p.ingresos : 0);
    const cur = serie[serie.length - 1];
    const prev = serie[serie.length - 2];
    const fmtDelta = (d: number | null) => (d === null ? null : pct(Math.abs(d)));
    const dSaldo = prev ? cambioRelativo(cur.neto, prev.neto) : null;
    const dIng = prev ? cambioRelativo(cur.ingresos, prev.ingresos) : null;
    const dGas = prev ? cambioRelativo(cur.gastos, prev.gastos) : null;
    const tasa = cur.ingresos > 0 ? ahorro(cur) : null;
    const dAhorro = prev && tasa !== null && prev.ingresos > 0 ? tasa - ahorro(prev) : null;
    return [
      { rotulo: 'Saldo del mes', valor: `${signo(cur.neto)}${formatMoneda(Math.abs(cur.neto))}`, color: cur.neto >= 0 ? t.ingreso : t.gasto, delta: fmtDelta(dSaldo), sube: (dSaldo ?? 0) >= 0, bueno: dSaldo === null ? null : dSaldo >= 0, serie: ult.map((p) => p.neto) },
      { rotulo: 'Ingresos', valor: formatMoneda(cur.ingresos), color: t.ingreso, delta: fmtDelta(dIng), sube: (dIng ?? 0) >= 0, bueno: dIng === null ? null : dIng >= 0, serie: ult.map((p) => p.ingresos) },
      { rotulo: 'Gastos', valor: formatMoneda(cur.gastos), color: t.gasto, delta: fmtDelta(dGas), sube: (dGas ?? 0) >= 0, bueno: dGas === null ? null : dGas <= 0, serie: ult.map((p) => p.gastos) },
      { rotulo: 'Ahorro', valor: tasa === null ? '—' : pct(tasa), color: t.acento, delta: dAhorro === null ? null : `${Math.round(Math.abs(dAhorro) * 100)} pts`, sube: (dAhorro ?? 0) >= 0, bueno: dAhorro === null ? null : dAhorro >= 0, serie: ult.map(ahorro) },
    ];
  }, [serie, t.ingreso, t.gasto, t.acento]);

  // ---------------------------------------------------------------- G2: saldo acumulado
  const saldo = useMemo(() => {
    if (!serie) return null;
    const base = serie[0].saldo_acumulado - serie[0].neto;
    const dif = serie[serie.length - 1].saldo_acumulado - base;
    const conclusion =
      Math.abs(dif) < 0.005
        ? `El saldo se mantuvo en ${formatMoneda(base)} durante ${MESES_SERIE} meses`
        : `El saldo ${dif > 0 ? 'subió' : 'bajó'} ${formatMoneda(Math.abs(dif))} en ${MESES_SERIE} meses`;
    return {
      conclusion,
      option: opcionSaldo(t, etiquetas, serie.map((p) => p.saldo_acumulado)),
      datos: { columnas: ['Mes', 'Saldo acumulado'], filas: serie.map((p) => [`${nombreMesCorto(p.mes)} ${p.anio}`, formatMoneda(p.saldo_acumulado)]) },
    };
  }, [serie, etiquetas, t]);

  // ---------------------------------------------------------------- G3: ingresos vs gastos
  const flujo = useMemo(() => {
    if (!serie) return null;
    const cur = serie[serie.length - 1];
    const previos = serie.slice(0, -1);
    const prom = (k: 'gastos' | 'ingresos') => (previos.length ? previos.reduce((s, p) => s + p[k], 0) / previos.length : 0);
    const dG = cambioRelativo(cur.gastos, prom('gastos'));
    const dI = cambioRelativo(cur.ingresos, prom('ingresos'));
    const frase = (nombre: string, d: number) =>
      Math.abs(d) < 0.01 ? `${nombre} en su promedio` : `${nombre} ${pct(Math.abs(d))} ${d > 0 ? 'sobre' : 'bajo'} el promedio`;
    const conclusion =
      dG === null && dI === null
        ? 'Aún no hay meses anteriores con qué comparar'
        : [dG !== null && frase('Gastos', dG), dI !== null && frase('ingresos', dI)].filter(Boolean).join('; ');
    return {
      conclusion,
      option: opcionIngresosGastos(t, etiquetas, serie.map((p) => p.ingresos), serie.map((p) => p.gastos), serie.map((p) => p.neto)),
      datos: {
        columnas: ['Mes', 'Ingresos', 'Gastos', 'Neto'],
        filas: serie.map((p) => [`${nombreMesCorto(p.mes)} ${p.anio}`, formatMoneda(p.ingresos), formatMoneda(p.gastos), formatMoneda(p.neto)]),
      },
    };
  }, [serie, etiquetas, t]);

  // ---------------------------------------------------------------- G4: diferencia mensual
  const diferencia = useMemo(() => {
    if (!serie) return null;
    const positivos = serie.filter((p) => p.neto > 0).length;
    const peor = serie.reduce((a, b) => (b.neto < a.neto ? b : a));
    const conclusion =
      peor.neto < 0
        ? `${positivos} de ${serie.length} meses cerraron en positivo; el peor fue ${nombreMesCorto(peor.mes)} (−${formatMoneda(Math.abs(peor.neto))})`
        : `Los ${serie.length} meses cerraron sin pérdida`;
    return {
      conclusion,
      option: opcionDiferencia(t, etiquetas, serie.map((p) => p.neto)),
      datos: { columnas: ['Mes', 'Ingreso − gasto'], filas: serie.map((p) => [`${nombreMesCorto(p.mes)} ${p.anio}`, formatMoneda(p.neto)]) },
    };
  }, [serie, etiquetas, t]);

  // ---------------------------------------------------------------- G5 / G6: gasto por categoría o grupo
  const subtituloMes = `${nombreMesCorto(mes)} ${anio}`;
  const categorias = resumen?.por_categoria;
  const grupoAbierto = grupos?.find((g) => g.grupo === grupoSel) ?? null;

  const radial = useMemo(() => {
    if (!categorias || grupos) return null;
    let items = categorias.map((c) => ({ nombre: c.nombre, proporcion: c.proporcion, total: c.total }));
    if (items.length > MAX_ANILLOS) {
      const resto = items.slice(MAX_ANILLOS - 1);
      items = [
        ...items.slice(0, MAX_ANILLOS - 1),
        { nombre: 'Otras', proporcion: resto.reduce((s, i) => s + i.proporcion, 0), total: resto.reduce((s, i) => s + i.total, 0) },
      ];
    }
    return {
      conclusion: items.length ? `${items[0].nombre} es la mayor categoría: ${pct(items[0].proporcion)} del gasto` : undefined,
      option: opcionRadial(t, items),
      datos: { columnas: ['Categoría', 'Gasto', '%'], filas: categorias.map((c) => [c.nombre, formatMoneda(c.total), pct(c.proporcion)]) },
    };
  }, [categorias, grupos, t]);

  const barrasGrupo = useMemo(() => {
    if (!grupos) return null;
    const items = grupoAbierto
      ? grupoAbierto.categorias.map((c) => ({ nombre: c.nombre, total: c.total }))
      : grupos.map((g) => ({ nombre: g.nombre, total: g.total }));
    const total = items.reduce((s, i) => s + i.total, 0);
    const conclusion = !items.length
      ? undefined
      : grupoAbierto
        ? `En ${grupoAbierto.nombre}, ${items[0].nombre} pesa ${pct(total > 0 ? items[0].total / total : 0)}`
        : `${items[0].nombre} concentra ${pct(grupos[0].proporcion)} del gasto`;
    return {
      conclusion,
      option: opcionBarrasH(t, items),
      alto: Math.max(200, 44 + items.length * 30),
      datos: { columnas: [grupoAbierto ? 'Categoría' : 'Grupo', 'Gasto'], filas: items.map((i) => [i.nombre, formatMoneda(i.total)]) },
    };
  }, [grupos, grupoAbierto, t]);

  // ---------------------------------------------------------------- G13: obligaciones
  const ob = analisis?.indicadores.obligaciones;

  return (
    <>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <div className="resumen__selector-mes">
        <button type="button" className="resumen__flecha" onClick={irMesAnterior} aria-label="Mes anterior">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M11 3l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="u-headline resumen__mes-actual">{nombreMesCorto(mes)} {anio}</span>
        <button type="button" className="resumen__flecha" onClick={irMesSiguiente} disabled={esMesActual} aria-label="Mes siguiente">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M7 3l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* G1 */}
      <div className="resumen__kpis" role="group" aria-label={`Indicadores de ${subtituloMes}`}>
        {kpis
          ? kpis.map((k) => (
              <KpiTile key={k.rotulo} rotulo={k.rotulo} valor={k.valor} color={k.color} delta={k.delta} sube={k.sube} bueno={k.bueno} serie={k.serie} />
            ))
          : [0, 1, 2, 3].map((i) => <KpiTile key={i} cargando rotulo="" valor="" delta={null} serie={[]} />)}
      </div>

      <div className="resumen__rejilla">
        {/* G2 */}
        <Grafico titulo="Saldo acumulado" subtitulo={periodo} conclusion={saldo?.conclusion} option={saldo?.option} vacio={sinMovimientos} datos={saldo?.datos} />

        {/* G3 */}
        <Grafico
          titulo="Ingresos vs. gastos"
          subtitulo={`${periodo} · neto en eje derecho`}
          conclusion={flujo?.conclusion}
          option={flujo?.option}
          vacio={sinMovimientos}
          datos={flujo?.datos}
        />

        {/* G4 */}
        <Grafico titulo="Diferencia mensual" subtitulo={periodo} conclusion={diferencia?.conclusion} option={diferencia?.option} vacio={sinMovimientos} datos={diferencia?.datos} />

        {/* G6 (con grupos) o G5 (sin grupos) */}
        {grupos && barrasGrupo ? (
          <Grafico
            titulo={grupoAbierto ? `Gasto en ${grupoAbierto.nombre}` : 'Gasto por grupo'}
            subtitulo={grupoAbierto ? `${subtituloMes} · categorías` : `${subtituloMes} · toca una barra para ver sus categorías`}
            conclusion={barrasGrupo.conclusion}
            option={barrasGrupo.option}
            alto={barrasGrupo.alto}
            datos={barrasGrupo.datos}
            acciones={
              grupoAbierto && (
                <button type="button" className="grafico__chip grafico__chip--activo" onClick={() => setGrupoSel(null)}>
                  ← Todos los grupos
                </button>
              )
            }
            onEvents={
              grupoAbierto
                ? undefined
                : {
                    click: (p) => {
                      const g = grupos[p.dataIndex];
                      if (g) setGrupoSel(g.grupo);
                    },
                  }
            }
          />
        ) : (
          <Grafico
            titulo="Gasto por categoría"
            subtitulo={subtituloMes}
            conclusion={radial?.conclusion}
            option={radial?.option}
            alto={240}
            vacio={!!categorias && categorias.length === 0}
            textoVacio="Sin gastos este mes. Registra uno para verlo acá."
            datos={radial?.datos}
          />
        )}

        {/* G13 */}
        {ob && ob.cantidad > 0 && (
          <Cumplimiento
            titulo="Obligaciones del mes"
            subtitulo={subtituloMes}
            conclusion={
              ob.pendiente <= 0
                ? `Las ${ob.cantidad} obligaciones del mes están pagadas`
                : `Pagado ${pct(ob.estimado > 0 ? ob.pagado / ob.estimado : 0)}; faltan ${formatMoneda(ob.pendiente)}`
            }
            filas={[
              {
                etiqueta: `Obligaciones pagadas (${ob.cantidad})`,
                texto: `${formatMoneda(ob.pagado)} de ${formatMoneda(ob.estimado)}`,
                proporcion: ob.estimado > 0 ? ob.pagado / ob.estimado : 0,
              },
            ]}
          />
        )}
      </div>

      <ResumenAnalisis mes={mes} anio={anio} />
    </>
  );
}
