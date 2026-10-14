import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  actualizarSaldoInicialCuenta,
  actualizarTrabajador,
  editarDeuda,
  useEspacioActivo,
  useTablero,
} from '../data/api';
import { explicarFormula } from '../data/tablero';
import type { Celda, Detalle, Edicion, FilaHoja, Hoja, IdHoja, Tablero as TableroDatos } from '../data/tablero';
import { exportarTableroXlsx } from '../data/exportarXlsx';
import { interpretarMonto } from '../data/importarTrabajadores';
import SelectorEspacio from '../components/SelectorEspacio';
import Modal from '../components/Modal';
import Boton from '../components/Boton';
import EditorMovimiento from '../components/EditorMovimiento';
import { nombreMes, nombreMesCorto } from '../design/format';
import '../components/Formulario.css';
import './Tablero.css';

/** Nombres de la vista: el modelo conserva los técnicos (el .xlsx los usa), acá todo en llano. */
const NOMBRE_PESTANA: Record<IdHoja, string> = {
  Resumen: 'Resumen',
  Resultados: 'Entradas y salidas',
  Planilla: 'Planilla',
  Caja: 'Cuentas',
  PorCobrarPagar: 'Deudas',
};

const ETIQUETA_FILA: Record<string, string> = {
  'Total ingresos': 'Entró en total',
  'Total gastos': 'Salió en total',
  'Resultado (ingresos − gastos)': 'Te quedó',
  Margen: '% que te quedó',
  'Resultado acumulado': 'Te quedó acumulado',
  Ingresos: 'Entró por',
  'Gastos por grupo': 'Salió por grupo',
  'Gastos por categoría': 'Salió por categoría',
  'Posición neta': 'Si cobras y pagas todo hoy, te queda',
  'Meses de caja': 'Te alcanza para',
  'Ingresos del mes': 'Entró este mes',
  'Gastos del mes': 'Salió este mes',
  'Margen del mes': '% que te quedó',
  'Costo de personal del mes': 'Pagado en personal este mes',
  'Personal / ingresos': 'Personal sobre lo que entró',
  'Planilla neta por pagar': 'Planilla por pagar',
  'Gasto promedio (3 meses)': 'Gasto por mes (promedio de 3)',
  Posición: 'Cómo estás hoy',
  Mes: 'Este mes',
  Aguante: 'Cuánto aguantas',
  'Total por pagar': 'Debes en total',
  'Total por cobrar': 'Te deben en total',
  Total: 'Total',
};

const etiquetaVista = (e: string) => ETIQUETA_FILA[e] ?? e;

/** Los textos explicativos del modelo nombran las hojas con sus nombres técnicos. */
const enLlano = (t: string) =>
  t
    .replace('hoja Caja', 'Cuentas')
    .replace('hoja Planilla', 'Planilla')
    .replace('hoja Por cobrar y por pagar', 'Deudas')
    .replace('en Resultados', 'en Entradas y salidas');

// ---------------------------------------------------------------------------------------------
// Formato

const num = (n: number, dec: number) =>
  Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const esCero = (v: unknown) => typeof v === 'number' && Math.abs(v) < 0.005;

/** Número de tabla, sin "S/" (va en el encabezado). El cero es un guion tenue. */
function fNum(v: number | string | null | undefined): string {
  if (typeof v !== 'number') return v ? String(v) : '';
  if (esCero(v)) return '—';
  return `${v < 0 ? '−' : ''}${num(v, 2)}`;
}

function fMon(v: number | string | null | undefined): string {
  if (typeof v !== 'number') return '—';
  return `${v < -0.005 ? '−' : ''}S/ ${num(v, 2)}`;
}

/** Para frases: sin decimales. */
const fMonR = (v: number) => `${v < -0.5 ? '−' : ''}S/ ${num(Math.round(v), 0)}`;

function fFecha(v: string | null | undefined): string {
  if (!v) return '—';
  const [a, m, d] = v.split('-');
  return `${d}/${m}/${a}`;
}

/** Formato completo, con unidad: para los chips de "Cómo se calcula" y el Resumen. */
function formatearCelda(c: Pick<Celda, 'v' | 'fmt'>): string {
  if (c.v === null || c.v === '') return '—';
  if (typeof c.v === 'string') return c.fmt === 'fecha' ? fFecha(c.v) : c.v;
  const neg = c.v < 0 && (c.fmt !== 'moneda' || Math.abs(c.v) >= 0.005) ? '−' : '';
  switch (c.fmt) {
    case 'moneda':
      return fMon(c.v);
    case 'pct':
      return `${neg}${num(c.v * 100, 1)} %`;
    case 'meses':
      return `${neg}${num(c.v, 1)} meses`;
    case 'entero':
      return `${neg}${num(Math.round(c.v), 0)}`;
    default:
      return String(c.v);
  }
}

const claveCelda = (h: IdHoja, etiqueta: string, k: number) => `${h}|${etiqueta}|${k}`;
const valorNum = (c: Celda | undefined) => (typeof c?.v === 'number' ? c.v : 0);
const buscar = (h: Hoja, etiqueta: string) => h.filas.findIndex((f) => f.etiqueta === etiqueta);

/** Cambio entre dos meses: texto, dirección y si "subir" es bueno. */
function cambio(actual: number | null, previo: number | null, pts = false) {
  if (actual === null || previo === null) return { texto: '—', dir: 'igual' as const };
  const dif = actual - previo;
  if (Math.abs(dif) < (pts ? 0.00005 : 0.005)) return { texto: '—', dir: 'igual' as const };
  const dir = dif > 0 ? ('sube' as const) : ('baja' as const);
  const flecha = dif > 0 ? '▲' : '▼';
  if (pts) return { texto: `${flecha} ${num(Math.abs(dif) * 100, 1)} pts`, dir };
  if (Math.abs(previo) < 0.005) return { texto: `${flecha} nuevo`, dir };
  return { texto: `${flecha} ${num((Math.abs(dif) / Math.abs(previo)) * 100, 0)} %`, dir };
}

function Cambio({ actual, previo, subeEsBueno, pts }: { actual: number | null; previo: number | null; subeEsBueno: boolean; pts?: boolean }) {
  const c = cambio(actual, previo, pts);
  const bueno = c.dir === 'igual' ? null : (c.dir === 'sube') === subeEsBueno;
  return <span className={`tablero__cambio ${bueno === null ? '' : bueno ? 'tablero__cambio--bueno' : 'tablero__cambio--malo'}`}>{c.texto}</span>;
}

function useAngosto(): boolean {
  const consulta = '(max-width: 767px)';
  const [angosto, setAngosto] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const alCambiar = () => setAngosto(m.matches);
    m.addEventListener('change', alCambiar);
    return () => m.removeEventListener('change', alCambiar);
  }, []);
  return angosto;
}

// ---------------------------------------------------------------------------------------------
// Contexto de acciones compartido por las vistas de cada hoja

interface Ctx {
  t: TableroDatos;
  mes: number;
  anio: number;
  angosto: boolean;
  cambiadas: Set<string>;
  resaltada: { hoja: IdHoja; fila: number } | null;
  calc: (h: Hoja, i: number, k: number) => void;
  ver: (h: Hoja, i: number, k: number, rotulo: string) => void;
  editar: (h: Hoja, i: number, k: number, rotulo: string) => void;
}

const destello = (c: Ctx, h: Hoja, f: FilaHoja, k: number) => (c.cambiadas.has(claveCelda(h.id, f.etiqueta, k)) ? 'tablero__flash' : '');
const resaltadaFila = (c: Ctx, h: Hoja, i: number) => (c.resaltada?.hoja === h.id && c.resaltada.fila === i ? 'tablero__fila--resaltada' : '');

function primeraConFormula(f: FilaHoja, preferida?: number): number {
  if (preferida !== undefined && f.celdas[preferida]?.f) return preferida;
  return f.celdas.findIndex((c) => c.f);
}

function EnlaceCalculo({ c, h, i, k }: { c: Ctx; h: Hoja; i: number; k: number }) {
  if (k < 0) return null;
  return (
    <button type="button" className="tablero__enlace" onClick={() => c.calc(h, i, k)}>
      ¿de dónde sale?
    </button>
  );
}

function EnlaceVer({ c, h, i, k, texto = 'Ver movimientos' }: { c: Ctx; h: Hoja; i: number; k: number; texto?: string }) {
  return (
    <button type="button" className="tablero__enlace tablero__enlace--ver" onClick={() => c.ver(h, i, k, etiquetaVista(h.filas[i].etiqueta))}>
      {texto} ›
    </button>
  );
}

/** Valor que se corrige: parece un campo y trae su botón "Editar" siempre visible. */
function CampoEditable({ c, h, i, k, texto, rotulo }: { c: Ctx; h: Hoja; i: number; k: number; texto: string; rotulo: string }) {
  const f = h.filas[i];
  return (
    <button type="button" className={`tablero__campo ${destello(c, h, f, k)}`} onClick={() => c.editar(h, i, k, rotulo)} aria-label={`Editar: ${rotulo}`}>
      <span className="tablero__campo-valor u-num">{texto}</span>
      <span className="tablero__campo-lapiz">✎ Editar</span>
    </button>
  );
}

/** "✓ Cuadra" o "⚠ No cuadra (S/ X)": sin números cuando todo está bien. */
function EstadoCuadre({ fila }: { fila: FilaHoja }) {
  const malas = fila.celdas.filter((c) => typeof c.v === 'number' && !esCero(c.v));
  if (malas.length === 0) return <span className="tablero__ok">✓ Cuadra</span>;
  return <span className="tablero__alerta">⚠ No cuadra ({malas.map((c) => fMon(Math.abs(c.v as number))).join(' y ')})</span>;
}

// ---------------------------------------------------------------------------------------------
// Tabla genérica (escritorio)

interface Col {
  titulo: string;
  num?: boolean;
  render: (f: FilaHoja, i: number) => ReactNode;
}

interface ConfigTabla {
  cols: Col[];
  etiquetaExtra?: (f: FilaHoja, i: number) => ReactNode;
  /** Contenido de la última columna (enlaces "Ver ..."). */
  acciones?: (f: FilaHoja, i: number) => ReactNode;
  ocultar?: (f: FilaHoja, i: number) => boolean;
}

function Tabla({ c, h, cfg }: { c: Ctx; h: Hoja; cfg: ConfigTabla }) {
  const conAcciones = Boolean(cfg.acciones);
  const total = cfg.cols.length + 1 + (conAcciones ? 1 : 0);
  return (
    <div className="tablero__grid">
      <table className="tablero__tabla">
        <thead>
          <tr>
            <th className="tablero__col-a">{h.columnas[0]}</th>
            {cfg.cols.map((col, n) => (
              <th key={n} className={col.num ? 'tablero__th-num' : 'tablero__th-txt'}>{col.titulo}</th>
            ))}
            {conAcciones && <th className="tablero__th-acc" />}
          </tr>
        </thead>
        <tbody>
          {h.filas.map((f, i) => {
            if (cfg.ocultar?.(f, i)) return null;
            const clase = `tablero__fila tablero__fila--${f.tipo} ${resaltadaFila(c, h, i)}`;
            if (f.tipo === 'seccion') {
              return (
                <tr key={i} className={clase} data-fila={i}>
                  <td colSpan={total}><span className="u-micro">{etiquetaVista(f.etiqueta)}</span></td>
                </tr>
              );
            }
            if (f.tipo === 'control') {
              if (!f.etiqueta.startsWith('Diferencia')) return null;
              return (
                <tr key={i} className={clase} data-fila={i}>
                  <td className="tablero__col-a">¿Cuadra con Entradas y salidas?</td>
                  <td colSpan={total - 1}><EstadoCuadre fila={f} /></td>
                </tr>
              );
            }
            return (
              <tr key={i} className={clase} data-fila={i}>
                <td className="tablero__col-a">
                  <span className="tablero__etiqueta">{etiquetaVista(f.etiqueta)}</span>
                  {f.nota && <span className="tablero__nota">{f.nota}</span>}
                  {cfg.etiquetaExtra?.(f, i)}
                </td>
                {cfg.cols.map((col, n) => (
                  <td key={n} className={col.num ? 'tablero__celda-num u-num' : ''}>{col.render(f, i)}</td>
                ))}
                {conAcciones && <td className="tablero__acc">{cfg.acciones!(f, i)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const esTotal = (f: FilaHoja) => f.tipo === 'total' || f.tipo === 'subtotal';

function Numero({ c, h, f, k, fmtFn = fNum }: { c: Ctx; h: Hoja; f: FilaHoja; k: number; fmtFn?: (v: number | string | null | undefined) => string }) {
  const celda = f.celdas[k];
  const negativo = typeof celda?.v === 'number' && celda.v <= -0.005;
  const cero = esCero(celda?.v);
  return <span className={`${destello(c, h, f, k)} ${negativo ? 'u-expense' : ''} ${cero ? 'tablero__cero' : ''}`}>{celda ? fmtFn(celda.v) : ''}</span>;
}

// ---------------------------------------------------------------------------------------------
// Entradas y salidas (Resultados)

function VistaResultados({ c, h }: { c: Ctx; h: Hoja }) {
  const [anual, setAnual] = useState(false);
  const iIng = buscar(h, 'Total ingresos');
  const iGas = buscar(h, 'Total gastos');
  const iRes = buscar(h, 'Resultado (ingresos − gastos)');
  const iMar = buscar(h, 'Margen');
  const mesAct = 11;
  const mesAnt = 10;

  const entro = valorNum(h.filas[iIng]?.celdas[mesAct]);
  const salio = valorNum(h.filas[iGas]?.celdas[mesAct]);
  const quedo = valorNum(h.filas[iRes]?.celdas[mesAct]);
  const margen = h.filas[iMar]?.celdas[mesAct]?.v;
  const mesTxt = nombreMes(c.mes);

  // Para pintar el cambio: en las filas de gastos, subir es malo.
  const gastoDeFila = useMemo(() => {
    const s = new Set<number>();
    let enGastos = false;
    h.filas.forEach((f, i) => {
      if (f.tipo === 'seccion') enGastos = f.etiqueta.startsWith('Gastos');
      if (enGastos || f.etiqueta === 'Total gastos') s.add(i);
    });
    return s;
  }, [h]);

  const primerMesConDatos = useMemo(() => {
    for (let k = 0; k < 12; k++) {
      if (h.filas.some((f) => f.tipo === 'dato' && !esCero(f.celdas[k]?.v) && f.celdas[k]?.v !== null)) return k;
    }
    return 11;
  }, [h]);

  const historia =
    entro === 0 && salio === 0 ? (
      <>En {mesTxt} todavía no hay movimientos.</>
    ) : (
      <>
        En {mesTxt} entraron <strong>{fMonR(entro)}</strong> y salieron <strong>{fMonR(salio)}</strong>.{' '}
        {quedo >= 0 ? 'Te quedaron' : 'Te faltaron'} <strong>{fMonR(Math.abs(quedo))}</strong>
        {typeof margen === 'number' ? ` (${Math.round(margen * 100)} %)` : ''}.
      </>
    );

  const cols: Col[] = anual
    ? [
        ...Array.from({ length: 12 - primerMesConDatos }, (_, n): Col => {
          const k = primerMesConDatos + n;
          return { titulo: `${h.columnas[k + 1]} (S/)`, num: true, render: (f) => <Numero c={c} h={h} f={f} k={k} fmtFn={f.tipo === 'dato' && f.etiqueta === 'Margen' ? pctTxt : fNum} /> };
        }),
        { titulo: 'Total (S/)', num: true, render: (f) => <Numero c={c} h={h} f={f} k={12} fmtFn={f.etiqueta === 'Margen' ? pctTxt : fNum} /> },
      ]
    : [
        { titulo: 'Este mes (S/)', num: true, render: (f) => (f.etiqueta === 'Margen' ? <Numero c={c} h={h} f={f} k={mesAct} fmtFn={pctTxt} /> : <Numero c={c} h={h} f={f} k={mesAct} />) },
        { titulo: 'Mes anterior (S/)', num: true, render: (f) => (f.etiqueta === 'Margen' ? <span className="u-num">{pctTxt(f.celdas[mesAnt]?.v)}</span> : <span className={esCero(f.celdas[mesAnt]?.v) ? 'tablero__cero' : ''}>{fNum(f.celdas[mesAnt]?.v)}</span>) },
        {
          titulo: 'Cambio',
          num: true,
          render: (f, i) => (
            <Cambio
              actual={nullNum(f.celdas[mesAct]?.v)}
              previo={nullNum(f.celdas[mesAnt]?.v)}
              pts={f.etiqueta === 'Margen'}
              subeEsBueno={!gastoDeFila.has(i)}
            />
          ),
        },
      ];

  return (
    <>
      <p className="tablero__historia">{historia}</p>
      <label className="tablero__interruptor">
        <input type="checkbox" checked={anual} onChange={(e) => setAnual(e.target.checked)} />
        <span>Ver los 12 meses</span>
      </label>
      {c.angosto && !anual ? (
        <TarjetasResultados c={c} h={h} gastoDeFila={gastoDeFila} />
      ) : (
        <Tabla
          c={c}
          h={h}
          cfg={{
            cols,
            ocultar: (f) => (!anual && f.tipo === 'dato' && esCero(f.celdas[mesAct]?.v) && esCero(f.celdas[mesAnt]?.v)) || (!anual && f.etiqueta === 'Resultado acumulado'),
            etiquetaExtra: (f, i) => (esTotal(f) ? <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, mesAct)} /> : null),
            acciones: anual ? undefined : (f, i) => (f.tipo === 'dato' && f.celdas[mesAct]?.detalle ? <EnlaceVer c={c} h={h} i={i} k={mesAct} /> : null),
          }}
        />
      )}
    </>
  );
}

const nullNum = (v: unknown) => (typeof v === 'number' ? v : null);
const pctTxt = (v: unknown) => (typeof v === 'number' ? `${num(v * 100, 1)} %` : '—');

function TarjetasResultados({ c, h, gastoDeFila }: { c: Ctx; h: Hoja; gastoDeFila: Set<number> }) {
  return (
    <div className="tablero__tarjetas">
      {h.filas.map((f, i) => {
        if (f.tipo === 'seccion') return <p key={i} className="tablero__tarjetas-seccion u-micro">{etiquetaVista(f.etiqueta)}</p>;
        if (f.tipo === 'control' || f.etiqueta === 'Resultado acumulado') return null;
        const act = nullNum(f.celdas[11]?.v);
        const ant = nullNum(f.celdas[10]?.v);
        if (f.tipo === 'dato' && esCero(act) && esCero(ant)) return null;
        const esMargen = f.etiqueta === 'Margen';
        return (
          <div key={i} className={`tablero__tarjeta tablero__tarjeta--${f.tipo} ${resaltadaFila(c, h, i)}`} data-fila={i}>
            <div className="tablero__tarjeta-linea">
              <span className="tablero__tarjeta-titulo">{etiquetaVista(f.etiqueta)}</span>
              <span className="u-num tablero__tarjeta-valor">
                <Numero c={c} h={h} f={f} k={11} fmtFn={esMargen ? pctTxt : fMon} />
              </span>
            </div>
            <div className="tablero__tarjeta-linea tablero__tarjeta-sub">
              <span>Mes anterior {esMargen ? pctTxt(ant) : fMon(ant)}</span>
              <Cambio actual={act} previo={ant} pts={esMargen} subeEsBueno={!gastoDeFila.has(i)} />
            </div>
            <div className="tablero__tarjeta-acciones">
              {esTotal(f) && <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 11)} />}
              {f.tipo === 'dato' && f.celdas[11]?.detalle && <EnlaceVer c={c} h={h} i={i} k={11} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Planilla

const nombreCorto = (n: string) => n;

function VistaPlanilla({ c, h }: { c: Ctx; h: Hoja }) {
  const iTot = buscar(h, 'Total');
  const tot = h.filas[iTot];
  const personas = h.filas.filter((f) => f.celdas[1]?.editar).length;
  const toca = valorNum(tot?.celdas[1]);
  const pagado = valorNum(tot?.celdas[2]);
  const falta = valorNum(tot?.celdas[3]);

  const historia = (
    <>
      Este mes toca pagar <strong>{fMonR(toca)}</strong> a <strong>{personas} {personas === 1 ? 'persona' : 'personas'}</strong>. Ya pagaste{' '}
      <strong>{fMonR(pagado)}</strong>. Falta <strong>{fMonR(falta)}</strong>.
    </>
  );

  const filaEsTrabajador = (f: FilaHoja) => Boolean(f.celdas[1]?.editar);
  const money = (k: number): Col['render'] => (f) => <Numero c={c} h={h} f={f} k={k} />;
  const cols: Col[] = [
    {
      titulo: 'Le toca (S/)',
      num: true,
      render: (f, i) => (filaEsTrabajador(f) ? <CampoEditable c={c} h={h} i={i} k={1} texto={fNum(f.celdas[1].v)} rotulo={`sueldo base de ${nombreCorto(f.etiqueta)}`} /> : <Numero c={c} h={h} f={f} k={1} />),
    },
    { titulo: 'Ya pagado (S/)', num: true, render: money(2) },
    { titulo: 'Falta (S/)', num: true, render: money(3) },
    { titulo: 'Adelantos a descontar (S/)', num: true, render: money(4) },
    { titulo: 'A pagar, sin adelantos (S/)', num: true, render: money(5) },
  ];

  return (
    <>
      <p className="tablero__historia">{historia}</p>
      {c.angosto ? (
        <div className="tablero__tarjetas">
          {h.filas.map((f, i) => {
            if (f.tipo === 'control') {
              if (!f.etiqueta.startsWith('Diferencia')) return null;
              return (
                <div key={i} className="tablero__tarjeta">
                  <div className="tablero__tarjeta-linea">
                    <span>¿Cuadra con Entradas y salidas?</span>
                    <EstadoCuadre fila={f} />
                  </div>
                </div>
              );
            }
            const esT = filaEsTrabajador(f);
            return (
              <div key={i} className={`tablero__tarjeta tablero__tarjeta--${f.tipo} ${resaltadaFila(c, h, i)}`} data-fila={i}>
                <div className="tablero__tarjeta-titulo">{f.tipo === 'total' ? 'Total del mes' : f.etiqueta}</div>
                {f.nota && <div className="u-footnote">{f.nota}{esT && f.celdas[0]?.v ? ` · ${f.celdas[0].v}` : ''}</div>}
                {f.tipo === 'total' ? (
                  <div className="tablero__tarjeta-linea tablero__tarjeta-sub">
                    <span>Le toca <b className="u-num">{fMon(f.celdas[1]?.v)}</b> · Pagado <b className="u-num">{fMon(f.celdas[2]?.v)}</b> · Falta <b className="u-num">{fMon(f.celdas[3]?.v)}</b></span>
                  </div>
                ) : esT ? (
                  <div className="tablero__tarjeta-cifras">
                    Le toca <b className="u-num">{fMon(f.celdas[1].v)}</b> · Pagado <b className={`u-num ${destello(c, h, f, 2)}`}>{fMon(f.celdas[2]?.v)}</b> · Falta{' '}
                    <b className={`u-num ${destello(c, h, f, 3)}`}>{fMon(f.celdas[3]?.v)}</b>
                    {valorNum(f.celdas[4]) > 0 && <> · Adelantos <b className="u-num">{fMon(f.celdas[4].v)}</b></>}
                  </div>
                ) : (
                  <div className="tablero__tarjeta-cifras">Pagado <b className="u-num">{fMon(f.celdas[2]?.v)}</b></div>
                )}
                <div className="tablero__tarjeta-acciones">
                  {esT && <Boton variante="secundario" tamano="chico" onClick={() => c.editar(h, i, 1, `sueldo base de ${nombreCorto(f.etiqueta)}`)}>✎ Editar sueldo</Boton>}
                  {f.celdas[2]?.detalle && <Boton variante="fantasma" tamano="chico" onClick={() => c.ver(h, i, 2, f.etiqueta)}>Ver pagos ›</Boton>}
                  {f.tipo === 'total' && <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 3)} />}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Tabla
          c={c}
          h={h}
          cfg={{
            cols,
            etiquetaExtra: (f, i) => (f.tipo === 'total' ? <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 3)} /> : null),
            acciones: (f, i) => (f.celdas[2]?.detalle ? <EnlaceVer c={c} h={h} i={i} k={2} texto="Ver pagos" /> : null),
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Cuentas (Caja)

function VistaCuentas({ c, h }: { c: Ctx; h: Hoja }) {
  const tot = h.filas[buscar(h, 'Total')];
  const n = h.filas.filter((f) => f.celdas[0]?.editar).length;
  const historia = (
    <>
      Tienes <strong>{fMonR(valorNum(tot?.celdas[3]))}</strong> en <strong>{n} {n === 1 ? 'cuenta' : 'cuentas'}</strong>.
    </>
  );
  const esCuenta = (f: FilaHoja) => Boolean(f.celdas[0]?.editar);
  const money = (k: number): Col['render'] => (f) => <Numero c={c} h={h} f={f} k={k} />;
  const cols: Col[] = [
    {
      titulo: 'Al empezar el mes (S/)',
      num: true,
      render: (f, i) => (esCuenta(f) ? <CampoEditable c={c} h={h} i={i} k={0} texto={fNum(f.celdas[0].v)} rotulo={`saldo al empezar el mes de ${f.etiqueta}`} /> : <Numero c={c} h={h} f={f} k={0} />),
    },
    { titulo: 'Entró (S/)', num: true, render: money(1) },
    { titulo: 'Salió (S/)', num: true, render: money(2) },
    { titulo: 'Saldo final (S/)', num: true, render: money(3) },
  ];

  return (
    <>
      <p className="tablero__historia">{historia}</p>
      {c.angosto ? (
        <div className="tablero__tarjetas">
          {h.filas.map((f, i) => {
            if (f.tipo === 'control') {
              if (!f.etiqueta.startsWith('Diferencia')) return null;
              return (
                <div key={i} className="tablero__tarjeta">
                  <div className="tablero__tarjeta-linea"><span>¿Cuadra con Entradas y salidas?</span><EstadoCuadre fila={f} /></div>
                </div>
              );
            }
            return (
              <div key={i} className={`tablero__tarjeta tablero__tarjeta--${f.tipo} ${resaltadaFila(c, h, i)}`} data-fila={i}>
                <div className="tablero__tarjeta-linea">
                  <span className="tablero__tarjeta-titulo">{f.tipo === 'total' ? 'Total' : f.etiqueta}</span>
                  <span className={`u-num tablero__tarjeta-valor ${destello(c, h, f, 3)}`}>{fMon(f.celdas[3]?.v)}</span>
                </div>
                <div className="tablero__tarjeta-cifras">
                  Al empezar <b className="u-num">{fMon(f.celdas[0]?.v)}</b> · Entró <b className="u-num">{fMon(f.celdas[1]?.v)}</b> · Salió <b className="u-num">{fMon(f.celdas[2]?.v)}</b>
                </div>
                <div className="tablero__tarjeta-acciones">
                  {esCuenta(f) && <Boton variante="secundario" tamano="chico" onClick={() => c.editar(h, i, 0, `saldo al empezar el mes de ${f.etiqueta}`)}>✎ Editar saldo inicial</Boton>}
                  {f.celdas[1]?.detalle && <Boton variante="fantasma" tamano="chico" onClick={() => c.ver(h, i, 1, `Entradas de ${f.etiqueta}`)}>Ver entradas ›</Boton>}
                  {f.celdas[2]?.detalle && <Boton variante="fantasma" tamano="chico" onClick={() => c.ver(h, i, 2, `Salidas de ${f.etiqueta}`)}>Ver salidas ›</Boton>}
                  {f.tipo === 'total' && <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 3)} />}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Tabla
          c={c}
          h={h}
          cfg={{
            cols,
            etiquetaExtra: (f, i) => (f.tipo === 'total' ? <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 3)} /> : null),
            acciones: (f, i) => (
              <>
                {f.celdas[1]?.detalle && <EnlaceVer c={c} h={h} i={i} k={1} texto="Ver entradas" />}
                {f.celdas[2]?.detalle && <EnlaceVer c={c} h={h} i={i} k={2} texto="Ver salidas" />}
              </>
            ),
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Deudas (PorCobrarPagar)

function estadoDias(dias: unknown): { texto: string; vencida: boolean } {
  if (typeof dias !== 'number') return { texto: 'Sin fecha', vencida: false };
  if (dias < 0) return { texto: `Venció hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, vencida: true };
  if (dias === 0) return { texto: 'Vence hoy', vencida: false };
  return { texto: `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}`, vencida: false };
}

function VistaDeudas({ c, h }: { c: Ctx; h: Hoja }) {
  const debo = h.filas.find((f) => f.etiqueta === 'Total por pagar');
  const meDeben = h.filas.find((f) => f.etiqueta === 'Total por cobrar');
  const filasDeuda = h.filas.filter((f) => f.celdas[4]?.editar);
  const vencidas = filasDeuda.filter((f) => f.celdas[0].v === 'Por pagar' && estadoDias(f.celdas[3]?.v).vencida).length;
  const historia = (
    <>
      Debes <strong>{fMonR(valorNum(debo?.celdas[4]))}</strong>
      {vencidas > 0 ? ` (${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'})` : ''} y te deben <strong>{fMonR(valorNum(meDeben?.celdas[4]))}</strong>.
    </>
  );
  const esDeuda = (f: FilaHoja) => Boolean(f.celdas[4]?.editar);
  const tipoTxt = (f: FilaHoja) => (f.celdas[0]?.v === 'Por pagar' ? 'Debes' : 'Te deben');

  const cols: Col[] = [
    { titulo: 'Tipo', render: (f) => (esDeuda(f) ? tipoTxt(f) : '') },
    {
      titulo: 'Vence',
      render: (f, i) =>
        esDeuda(f) ? (
          f.celdas[2]?.editar ? (
            <CampoEditable c={c} h={h} i={i} k={2} texto={fFecha(f.celdas[2].v as string | null)} rotulo={`fecha de vencimiento de ${f.etiqueta}`} />
          ) : null
        ) : null,
    },
    {
      titulo: 'Estado',
      render: (f) => {
        if (!esDeuda(f)) return null;
        const e = estadoDias(f.celdas[3]?.v);
        return <span className={e.vencida ? 'tablero__alerta' : 'tablero__suave'}>{e.texto}</span>;
      },
    },
    {
      titulo: 'Pendiente (S/)',
      num: true,
      render: (f, i) => (esDeuda(f) ? <CampoEditable c={c} h={h} i={i} k={4} texto={fNum(f.celdas[4].v)} rotulo={`monto pendiente de ${f.etiqueta}`} /> : <Numero c={c} h={h} f={f} k={4} />),
    },
  ];

  return (
    <>
      <p className="tablero__historia">{historia}</p>
      {filasDeuda.length === 0 && <p className="u-footnote">No hay deudas abiertas.</p>}
      {c.angosto ? (
        <div className="tablero__tarjetas">
          {h.filas.map((f, i) => {
            if (esDeuda(f)) {
              const e = estadoDias(f.celdas[3]?.v);
              return (
                <div key={i} className={`tablero__tarjeta ${resaltadaFila(c, h, i)}`} data-fila={i}>
                  <div className="tablero__tarjeta-linea">
                    <span className="tablero__tarjeta-titulo">{f.etiqueta}</span>
                    <span className={`u-num tablero__tarjeta-valor ${destello(c, h, f, 4)}`}>{fMon(f.celdas[4].v)}</span>
                  </div>
                  {f.nota && <div className="u-footnote">{f.nota}</div>}
                  <div className="tablero__tarjeta-cifras">
                    {tipoTxt(f)} · vence {fFecha(f.celdas[2]?.v as string | null)} · <span className={e.vencida ? 'tablero__alerta' : ''}>{e.texto}</span>
                  </div>
                  <div className="tablero__tarjeta-acciones">
                    <Boton variante="secundario" tamano="chico" onClick={() => c.editar(h, i, 4, `monto pendiente de ${f.etiqueta}`)}>✎ Editar monto</Boton>
                    <Boton variante="secundario" tamano="chico" onClick={() => c.editar(h, i, 2, `fecha de vencimiento de ${f.etiqueta}`)}>✎ Editar fecha</Boton>
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="tablero__tarjeta tablero__tarjeta--total">
                <div className="tablero__tarjeta-linea">
                  <span className="tablero__tarjeta-titulo">{etiquetaVista(f.etiqueta)}</span>
                  <span className={`u-num tablero__tarjeta-valor ${destello(c, h, f, 4)}`}>{fMon(f.celdas[4]?.v)}</span>
                </div>
                <div className="tablero__tarjeta-acciones"><EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 4)} /></div>
              </div>
            );
          })}
        </div>
      ) : (
        <Tabla
          c={c}
          h={h}
          cfg={{
            cols,
            etiquetaExtra: (f, i) => (f.tipo === 'total' ? <EnlaceCalculo c={c} h={h} i={i} k={primeraConFormula(f, 4)} /> : null),
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Resumen

function VistaResumen({ c, h }: { c: Ctx; h: Hoja }) {
  const mesTxt = nombreMes(c.mes);
  const tiles: Array<{ etiqueta: string; titulo: string; ayuda: string; tono?: 'ok' | 'mal' }> = [
    { etiqueta: 'Caja disponible', titulo: 'Tienes', ayuda: 'Lo que hay hoy en todas tus cuentas.' },
    { etiqueta: 'Por pagar', titulo: 'Debes', ayuda: 'Lo que falta pagar: planilla, SUNAT, proveedores.' },
    { etiqueta: 'Por cobrar', titulo: 'Te deben', ayuda: 'Lo que otros te tienen que pagar.' },
    { etiqueta: 'Resultado del mes', titulo: 'Te quedó este mes', ayuda: `Lo que entró menos lo que salió en ${mesTxt}.` },
  ];
  const usados = new Set(tiles.map((t) => t.etiqueta));
  const indice = (e: string) => h.filas.findIndex((f) => f.etiqueta === e);

  return (
    <>
      <div className="tablero__tiles">
        {tiles.map((t) => {
          const i = indice(t.etiqueta);
          const f = h.filas[i];
          if (!f) return null;
          const v = f.celdas[0]?.v;
          const mal = typeof v === 'number' && v < -0.005 && t.etiqueta === 'Resultado del mes';
          return (
            <div key={t.etiqueta} className={`tablero__tile ${resaltadaFila(c, h, i)}`} data-fila={i}>
              <span className="u-micro">{t.titulo}</span>
              <span className={`tablero__tile-valor u-num ${destello(c, h, f, 0)} ${mal ? 'u-expense' : ''}`}>{fMon(v)}</span>
              <span className="u-footnote">{t.ayuda}</span>
              <EnlaceCalculo c={c} h={h} i={i} k={0} />
            </div>
          );
        })}
      </div>

      <div className="tablero__lista">
        {h.filas.map((f, i) => {
          if (usados.has(f.etiqueta)) return null;
          if (f.tipo === 'seccion') return <p key={i} className="tablero__lista-seccion u-micro">{etiquetaVista(f.etiqueta)}</p>;
          const explicacion = typeof f.celdas[1]?.v === 'string' ? enLlano(f.celdas[1].v) : '';
          return (
            <div key={i} className={`tablero__lista-fila tablero__lista-fila--${f.tipo} ${resaltadaFila(c, h, i)}`} data-fila={i}>
              <div className="tablero__lista-texto">
                <span className="tablero__etiqueta">{etiquetaVista(f.etiqueta)}</span>
                {explicacion && <span className="tablero__nota">{explicacion}</span>}
                <EnlaceCalculo c={c} h={h} i={i} k={0} />
              </div>
              <span className={`u-num tablero__lista-valor ${destello(c, h, f, 0)}`}>{formatearCelda(f.celdas[0])}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Contenedor

interface EdicionActiva {
  hoja: IdHoja;
  fila: number;
  col: number;
  texto: string;
  editar: Edicion;
  original: number | string | null;
  rotulo: string;
  error: string | null;
  guardando: boolean;
}

interface PanelCalculo {
  hoja: IdHoja;
  fila: number;
  col: number;
}

interface PanelDetalle {
  hoja: IdHoja;
  etiquetaFila: string;
  col: number;
  titulo: string;
  detalle: Detalle;
}

export default function Tablero() {
  const hoy = useMemo(() => new Date(), []);
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [idHoja, setIdHoja] = useState<IdHoja>('Resumen');
  const [exportando, setExportando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<EdicionActiva | null>(null);
  const [calculo, setCalculo] = useState<PanelCalculo | null>(null);
  const [detalle, setDetalle] = useState<PanelDetalle | null>(null);
  const [filaResaltada, setFilaResaltada] = useState<{ hoja: IdHoja; fila: number } | null>(null);
  const [cambiadas, setCambiadas] = useState<Set<string>>(new Set());
  const tablero = useTablero(mes, anio);
  const espacio = useEspacioActivo();
  const angosto = useAngosto();
  const paginaRef = useRef<HTMLDivElement>(null);
  const previos = useRef<{ clave: string; datos: Map<string, number | string | null> } | null>(null);

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

  // Planilla solo existe si el libro tiene personal: si la hoja activa desaparece, vuelve al Resumen.
  const hoja: Hoja | undefined = tablero ? (tablero.hojas.find((h) => h.id === idHoja) ?? tablero.hojas[0]) : undefined;

  // Destello en lo que cambió tras una corrección: así se ve cómo reaccionan los totales.
  useEffect(() => {
    if (!tablero) return;
    const datos = new Map<string, number | string | null>();
    for (const h of tablero.hojas) {
      for (const f of h.filas) f.celdas.forEach((c, k) => datos.set(claveCelda(h.id, f.etiqueta, k), c.v));
    }
    const clave = `${espacio?.id_espacio}|${tablero.mes}|${tablero.anio}`;
    const prev = previos.current;
    previos.current = { clave, datos };
    if (!prev || prev.clave !== clave) return;
    const nuevas = new Set<string>();
    for (const [k, v] of datos) {
      if (!prev.datos.has(k)) continue;
      const antes = prev.datos.get(k);
      const distinto = typeof v === 'number' && typeof antes === 'number' ? Math.abs(v - antes) > 0.0049 : v !== antes;
      if (distinto) nuevas.add(k);
    }
    if (nuevas.size === 0) return;
    setCambiadas(nuevas);
    const t = setTimeout(() => setCambiadas(new Set()), 2200);
    return () => clearTimeout(t);
  }, [tablero, espacio?.id_espacio]);

  useEffect(() => {
    if (!filaResaltada) return;
    paginaRef.current?.querySelector(`[data-fila="${filaResaltada.fila}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setFilaResaltada(null), 2200);
    return () => clearTimeout(t);
  }, [filaResaltada]);

  function saltarA(h: IdHoja, fila: number) {
    setCalculo(null);
    setIdHoja(h);
    // `fila` viene en numeración de Excel (fila 2 = primera de datos).
    setFilaResaltada({ hoja: h, fila: fila - 2 });
  }

  const ctx: Ctx | null = tablero
    ? {
        t: tablero,
        mes,
        anio,
        angosto,
        cambiadas,
        resaltada: filaResaltada,
        calc: (h, i, k) => setCalculo({ hoja: h.id, fila: i, col: k }),
        ver: (h, i, k, rotulo) => {
          const d = h.filas[i].celdas[k]?.detalle;
          if (!d) return;
          setDetalle({ hoja: h.id, etiquetaFila: h.filas[i].etiqueta, col: k, titulo: rotulo, detalle: d });
        },
        editar: (h, i, k, rotulo) => {
          const celda = h.filas[i].celdas[k];
          if (!celda?.editar) return;
          setEdicion({
            hoja: h.id,
            fila: i,
            col: k,
            editar: celda.editar,
            original: celda.v,
            texto: celda.v === null ? '' : String(celda.v),
            rotulo,
            error: null,
            guardando: false,
          });
        },
      }
    : null;

  async function guardarEdicion() {
    const ed = edicion;
    if (!ed || ed.guardando) return;
    setEdicion({ ...ed, guardando: true, error: null });
    try {
      const { editar } = ed;
      if (editar.campo === 'fecha_vencimiento') {
        if (!ed.texto) throw new Error('Elige una fecha.');
        if (ed.texto !== ed.original) await editarDeuda(editar.id, { fecha_vencimiento: ed.texto });
      } else {
        const valor = interpretarMonto(ed.texto);
        if (!Number.isFinite(valor) || valor < 0) throw new Error('Escribe un monto válido.');
        if (Math.abs(valor - (Number(ed.original) || 0)) >= 0.005) {
          if (editar.entidad === 'trabajador') await actualizarTrabajador(editar.id, { sueldo_base: valor });
          else if (editar.entidad === 'deuda') await editarDeuda(editar.id, { monto_pendiente: valor });
          else await actualizarSaldoInicialCuenta(editar.id, Math.round((valor - editar.base) * 100) / 100);
        }
      }
      setEdicion(null);
    } catch (e) {
      setEdicion({ ...ed, guardando: false, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
    }
  }

  async function descargar() {
    if (!tablero || exportando) return;
    setExportando(true);
    setMensaje(null);
    try {
      const libro = (espacio?.nombre ?? 'libro')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      await exportarTableroXlsx(tablero, `chanchito_${libro}_${anio}-${String(mes).padStart(2, '0')}.xlsx`);
    } catch {
      setMensaje('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="tablero__pagina" ref={paginaRef}>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <div className="tablero__barra">
        <div className="tablero__mes">
          <button type="button" className="tablero__flecha" onClick={irMesAnterior} aria-label="Mes anterior">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M11 3l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="u-headline tablero__mes-actual">{nombreMesCorto(mes)} {anio}</span>
          <button type="button" className="tablero__flecha" onClick={irMesSiguiente} disabled={esMesActual} aria-label="Mes siguiente">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M7 3l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <button type="button" className="tablero__descargar" onClick={descargar} disabled={!tablero || exportando}>
          {exportando ? 'Generando…' : 'Descargar Excel'}
        </button>
      </div>
      {mensaje && <p className="tablero__error" role="alert">{mensaje}</p>}

      {!tablero || !hoja || !ctx ? (
        <div className="tablero__esqueleto" aria-busy="true" aria-label="Cargando tablero">
          <div className="u-skeleton" style={{ height: 44 }} />
          <div className="u-skeleton" style={{ height: 28, width: '55%' }} />
          <div className="u-skeleton" style={{ height: 300 }} />
        </div>
      ) : (
        <>
          <h2 className="u-title-2">{NOMBRE_PESTANA[hoja.id]}</h2>
          {hoja.id === 'Resumen' && <VistaResumen c={ctx} h={hoja} />}
          {hoja.id === 'Resultados' && <VistaResultados key={`${espacio?.id_espacio}`} c={ctx} h={hoja} />}
          {hoja.id === 'Planilla' && <VistaPlanilla c={ctx} h={hoja} />}
          {hoja.id === 'Caja' && <VistaCuentas c={ctx} h={hoja} />}
          {hoja.id === 'PorCobrarPagar' && <VistaDeudas c={ctx} h={hoja} />}

          <nav className="tablero__hojas" role="tablist" aria-label="Hojas del libro">
            {tablero.hojas.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={x.id === hoja.id}
                className={`tablero__hoja ${x.id === hoja.id ? 'tablero__hoja--activa' : ''}`}
                onClick={() => setIdHoja(x.id)}
              >
                {NOMBRE_PESTANA[x.id]}
              </button>
            ))}
          </nav>

          {calculo && <PanelCalculoCelda tablero={tablero} panel={calculo} onCerrar={() => setCalculo(null)} onSaltar={saltarA} />}
          {detalle && (
            <EditorMovimiento
              titulo={detalle.titulo}
              detalle={detalle.detalle}
              valorCelda={valorDeDetalle(tablero, detalle)}
              onCerrar={() => setDetalle(null)}
            />
          )}
          {edicion && (
            <Modal abierto onCerrar={() => setEdicion(null)} titulo={`Corregir ${edicion.rotulo}`}>
              <form
                className="tablero__editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  void guardarEdicion();
                }}
              >
                <label className="form-campo">
                  <span className="u-subhead">{edicion.editar.campo === 'fecha_vencimiento' ? 'Nueva fecha' : 'Nuevo monto (S/)'}</span>
                  <input
                    className="form-input u-num"
                    autoFocus
                    type={edicion.editar.campo === 'fecha_vencimiento' ? 'date' : 'text'}
                    inputMode={edicion.editar.campo === 'fecha_vencimiento' ? undefined : 'decimal'}
                    value={edicion.texto}
                    onChange={(e) => setEdicion({ ...edicion, texto: e.target.value, error: null })}
                  />
                </label>
                {edicion.error && <p className="tablero__error" role="alert">{edicion.error}</p>}
                <div className="tablero__editor-botones">
                  <Boton variante="secundario" bloque type="button" onClick={() => setEdicion(null)}>Cancelar</Boton>
                  <Boton bloque type="submit" disabled={edicion.guardando}>{edicion.guardando ? 'Guardando…' : 'Guardar'}</Boton>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

/** Valor actual de la celda que abrió el detalle (la fila se busca por etiqueta: Resultados reordena al editar). */
function valorDeDetalle(t: TableroDatos, d: PanelDetalle): number {
  const h = t.hojas.find((x) => x.id === d.hoja);
  const v = h?.filas.find((f) => f.etiqueta === d.etiquetaFila)?.celdas[d.col]?.v;
  return typeof v === 'number' ? v : 0;
}

function PanelCalculoCelda({
  tablero,
  panel,
  onCerrar,
  onSaltar,
}: {
  tablero: TableroDatos;
  panel: PanelCalculo;
  onCerrar: () => void;
  onSaltar: (h: IdHoja, fila: number) => void;
}) {
  const h = tablero.hojas.find((x) => x.id === panel.hoja);
  const fila = h?.filas[panel.fila];
  const celda = fila?.celdas[panel.col];
  if (!h || !fila || !celda?.f) return null;
  const piezas = explicarFormula(tablero, h.id, celda.f);
  const multi = h.id === 'Resultados' || h.id === 'Planilla';
  const explicacion = h.id === 'Resumen' && typeof fila.celdas[1]?.v === 'string' ? enLlano(fila.celdas[1].v) : undefined;

  return (
    <Modal abierto onCerrar={onCerrar} titulo="¿De dónde sale?">
      <p className="u-headline">
        {etiquetaVista(fila.etiqueta)}
        {multi ? ` · ${h.columnas[panel.col + 1]}` : ''}
      </p>
      <p className="tablero__ecuacion">
        {piezas.map((p, i) =>
          p.tipo === 'texto' ? (
            <span key={i} className="tablero__ec-texto">{p.texto}</span>
          ) : (
            <button key={i} type="button" className="tablero__chip" onClick={() => onSaltar(p.hoja, p.fila)}>
              <span>{enLlano(p.etiqueta)}</span>
              <b className="u-num">{formatearCelda({ v: p.valor, fmt: p.fmt })}</b>
            </button>
          ),
        )}
        <span className="tablero__ec-texto"> = </span>
        <span className="tablero__chip tablero__chip--resultado">
          <b className="u-num">{formatearCelda(celda)}</b>
        </span>
      </p>
      {explicacion && <p className="u-footnote">{explicacion}</p>}
      <p className="u-footnote">Toca un número de arriba para ir a la fila de donde sale.</p>
    </Modal>
  );
}
