import { useEffect, useMemo, useState } from 'react';
import ilustracionVacio from '../assets/vacio.webp';
import type { Sesion, TipoMovimiento } from '../data/types';
import { useCategorias, usePorPagarPronto, useResumenRango, useTransacciones, useUsoCategorias, useUsuarios } from '../data/api';
import { fechaYmd, mover, rangoDe, type TipoPeriodo } from '../data/periodo';
import { formatMoneda, formatMontoConSigno } from '../design/format';
import RuedaCategorias, { type DestinoRueda } from '../components/RuedaCategorias';
import HojaRegistro from '../components/HojaRegistro';
import HojaSugerencias, { HojaPago, type PagoPendiente } from '../components/HojaSugerencias';
import './InicioMovil.css';

export interface DestinoMovimientos {
  categoria?: string;
  /** Mes (1-12) y año del período que se estaba viendo; Movimientos filtra por mes. */
  mes: number;
  anio: number;
}

interface InicioMovilProps {
  sesion: Sesion;
  /** Lleva a Movimientos (con filtro de categoría y mes si se indican). */
  onVerMovimientos: (destino: DestinoMovimientos) => void;
}

const PERIODOS: Array<{ id: TipoPeriodo; etiqueta: string }> = [
  { id: 'dia', etiqueta: 'Día' },
  { id: 'semana', etiqueta: 'Semana' },
  { id: 'mes', etiqueta: 'Mes' },
  { id: 'anio', etiqueta: 'Año' },
];

/** Huella corta estilo cadena (DESIGN § 2.5): el id sin su prefijo, primeros 6 caracteres. */
function huella(id: string): string {
  return id.replace(/^[A-Za-z]+_/, '').slice(0, 6);
}

/** Oculta los botones flotantes al bajar y los muestra al subir (la página se desplaza en window). */
function useOcultarAlBajar(): boolean {
  const [oculto, setOculto] = useState(false);
  useEffect(() => {
    let ultimo = window.scrollY;
    function alDesplazar() {
      const y = window.scrollY;
      if (Math.abs(y - ultimo) < 8) return;
      setOculto(y > ultimo && y > 80);
      ultimo = y;
    }
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => window.removeEventListener('scroll', alDesplazar);
  }, []);
  return oculto;
}

const FLECHA_IZQ = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FLECHA_DER = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Inicio del móvil (DESIGN § 8.1 / 8.1-bis): selector de período, saldo destacado, rueda de
 * categorías (un toque en un ícono abre la hoja de registro), últimos movimientos y el doble
 * botón flotante − Gasto / + Ingreso.
 */
export default function InicioMovil({ sesion, onVerMovimientos }: InicioMovilProps) {
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>('mes');
  const [ancla, setAncla] = useState(() => new Date());
  const [hoja, setHoja] = useState<{ abierto: boolean; tipo: TipoMovimiento; categoria?: string; monto?: number; nota?: string; trabajador?: string }>({
    abierto: false,
    tipo: 'gasto',
  });
  const [destino, setDestino] = useState<DestinoRueda | null>(null);
  const [pago, setPago] = useState<PagoPendiente | null>(null);
  const [avisoPagado, setAvisoPagado] = useState(false);
  const ocultarBotones = useOcultarAlBajar();

  const rango = useMemo(() => rangoDe(tipoPeriodo, ancla), [tipoPeriodo, ancla]);
  const hoy = fechaYmd(new Date());
  const esActual = rango.hasta >= hoy;

  const resumen = useResumenRango(rango.desde, rango.hasta);
  const categoriasGasto = useCategorias('gasto');
  const categorias = useCategorias();
  const uso = useUsoCategorias('gasto');
  const usuarios = useUsuarios();
  const transacciones = useTransacciones();
  const porPagar = usePorPagarPronto(7);

  const categoriaPorId = useMemo(() => new Map((categorias ?? []).map((c) => [c.id_categoria, c])), [categorias]);
  const usuarioPorId = useMemo(() => new Map((usuarios ?? []).map((u) => [u.id_usuario, u])), [usuarios]);
  const recientes = (transacciones ?? []).slice(0, 5);

  const mesAncla = ancla.getMonth() + 1;
  const anioAncla = ancla.getFullYear();

  function abrirHoja(tipo: TipoMovimiento, categoria?: string, previo?: { monto?: number; nota?: string; trabajador?: string }) {
    setHoja({ abierto: true, tipo, categoria, ...previo });
  }

  // El aviso "Pagado" vive aquí para sobrevivir al cierre de la hoja de pago.
  useEffect(() => {
    if (!avisoPagado) return;
    const id = window.setTimeout(() => setAvisoPagado(false), 2200);
    return () => window.clearTimeout(id);
  }, [avisoPagado]);

  return (
    <div className="inicio">
      <div className="inicio__periodos" role="tablist" aria-label="Período">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === tipoPeriodo}
            className={`inicio__periodo ${p.id === tipoPeriodo ? 'inicio__periodo--activo' : ''}`}
            onClick={() => {
              setTipoPeriodo(p.id);
              setAncla(new Date());
            }}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="inicio__navegador">
        <button type="button" className="inicio__flecha" onClick={() => setAncla((a) => mover(tipoPeriodo, a, -1))} aria-label="Período anterior">
          {FLECHA_IZQ}
        </button>
        <span className="inicio__rango u-footnote">{rango.etiqueta}</span>
        <button
          type="button"
          className="inicio__flecha"
          onClick={() => setAncla((a) => mover(tipoPeriodo, a, 1))}
          disabled={esActual}
          aria-label="Período siguiente"
        >
          {FLECHA_DER}
        </button>
      </div>

      <section className="tarjeta tarjeta--destacada inicio__hero" aria-label={`Saldo de ${rango.etiqueta}`}>
        <p className="inicio__hero-titulo">Saldo de {rango.etiqueta}</p>
        {resumen === undefined ? (
          <div className="u-skeleton" style={{ height: 48 }} aria-hidden="true" />
        ) : (
          <p className={`inicio__saldo u-num ${resumen.saldo < 0 ? 'u-expense' : ''}`}>{formatMoneda(resumen.saldo)}</p>
        )}
        <div className="inicio__kpis">
          <div className="inicio__kpi">
            <span className="inicio__kpi-icono inicio__kpi-icono--ingreso" aria-hidden="true">↑</span>
            <span className="inicio__kpi-datos">
              <span className="u-micro">Ingresos</span>
              <span className="inicio__kpi-monto u-num u-income">{resumen ? formatMoneda(resumen.ingresos) : '—'}</span>
            </span>
          </div>
          <div className="inicio__kpi">
            <span className="inicio__kpi-icono inicio__kpi-icono--gasto" aria-hidden="true">↓</span>
            <span className="inicio__kpi-datos">
              <span className="u-micro">Gastos</span>
              <span className="inicio__kpi-monto u-num u-expense">{resumen ? formatMoneda(resumen.gastos) : '—'}</span>
            </span>
          </div>
        </div>
      </section>

      {porPagar !== undefined && porPagar.length > 0 && (
        <section className="inicio__por-pagar" aria-label="Por pagar esta semana">
          <h2 className="u-title-3 inicio__por-pagar-titulo">Por pagar esta semana</h2>
          <ul className="inicio__por-pagar-lista">
            {porPagar.map(({ deuda, dias, id_categoria }) => {
              const vencido = dias < 0;
              const detalle = vencido ? `Venció hace ${-dias} día${dias === -1 ? '' : 's'}` : dias === 0 ? 'Vence hoy' : `Vence en ${dias} día${dias === 1 ? '' : 's'}`;
              return (
                <li key={deuda.id_deuda} className={`inicio__debe ${vencido ? 'inicio__debe--vencido' : 'inicio__debe--pronto'}`}>
                  <span className="inicio__debe-estado u-micro">{vencido ? 'Vencido' : 'Pronto'}</span>
                  <span className="inicio__debe-titulo">
                    {deuda.id_prestamo ? `${deuda.persona} · cuota ${deuda.nro_cuota ?? ''}`.trim() : deuda.persona}
                  </span>
                  <span className="inicio__debe-monto u-num">{formatMoneda(deuda.monto_pendiente)}</span>
                  <span className="inicio__debe-detalle u-footnote">{detalle}</span>
                  <button
                    type="button"
                    className="inicio__debe-pagar"
                    onClick={() =>
                      setPago({
                        id_deuda: deuda.id_deuda,
                        titulo: deuda.persona,
                        monto: deuda.monto_pendiente,
                        id_categoria,
                        urgencia: vencido ? 'vencido' : 'pronto',
                        detalle,
                      })
                    }
                  >
                    Pagar
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="tarjeta inicio__bloque" aria-label="Gastos por categoría">
        <header className="inicio__bloque-cabecera">
          <h2 className="u-title-3">Gastos por categoría</h2>
          <span className="u-footnote">% del total</span>
        </header>
        <RuedaCategorias
          resumen={resumen}
          categorias={categoriasGasto}
          uso={uso}
          etiqueta={rango.etiqueta}
          onElegir={setDestino}
          onVerMovimientos={(categoria) => onVerMovimientos({ categoria, mes: mesAncla, anio: anioAncla })}
        />
      </section>

      <section className="tarjeta inicio__bloque" aria-label="Movimientos recientes">
        <header className="inicio__bloque-cabecera">
          <h2 className="u-title-3">Movimientos recientes</h2>
          <button type="button" className="inicio__ver-todos" onClick={() => onVerMovimientos({ mes: mesAncla, anio: anioAncla })}>
            Ver todos →
          </button>
        </header>
        {transacciones === undefined ? (
          <div className="u-skeleton" style={{ height: 120 }} aria-hidden="true" />
        ) : recientes.length === 0 ? (
          <div className="u-estado-vacio">
            <img className="u-estado-vacio__ilustracion" src={ilustracionVacio} alt="" aria-hidden="true" />
            <p className="u-callout">Aún no hay movimientos.</p>
            <p className="u-footnote">Toca un ícono de la rueda o − Gasto para registrar el primero.</p>
          </div>
        ) : (
          <ul className="inicio__lista">
            {recientes.map((t) => {
              const cat = categoriaPorId.get(t.id_categoria);
              const esGasto = t.tipo === 'gasto';
              return (
                <li key={t.id_transaccion}>
                  <button type="button" className="inicio__fila" onClick={() => onVerMovimientos({ mes: mesAncla, anio: anioAncla })}>
                    <span className="inicio__fila-icono" style={{ ['--cat' as string]: cat?.color ?? 'var(--text-3)' }} aria-hidden="true">
                      {cat?.icono ?? '•'}
                    </span>
                    <span className="inicio__fila-datos">
                      <span className="inicio__fila-titulo">{t.descripcion || cat?.nombre || 'Sin descripción'}</span>
                      <span className="u-footnote">{usuarioPorId.get(t.id_usuario)?.nombre ?? '—'}</span>
                    </span>
                    <span className="inicio__fila-derecha">
                      <span className={`u-amount u-num ${esGasto ? 'u-expense' : 'u-income'}`}>{formatMontoConSigno(t.monto, t.tipo)}</span>
                      <span className="inicio__huella u-num" title="Huella del movimiento">◆ {huella(t.id_transaccion)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className={`inicio__flotantes ${ocultarBotones ? 'inicio__flotantes--ocultos' : ''}`}>
        <button type="button" className="inicio__fab inicio__fab--gasto" onClick={() => abrirHoja('gasto')}>
          <span aria-hidden="true">−</span> Gasto
        </button>
        <button type="button" className="inicio__fab inicio__fab--ingreso" onClick={() => abrirHoja('ingreso')}>
          <span aria-hidden="true">+</span> Ingreso
        </button>
      </div>

      <HojaSugerencias
        destino={destino}
        onCerrar={() => setDestino(null)}
        onRegistrar={(r) => {
          setDestino(null);
          abrirHoja('gasto', r.categoria, { monto: r.monto, nota: r.descripcion, trabajador: r.trabajador });
        }}
        onPagar={(p) => {
          setDestino(null);
          setPago(p);
        }}
      />

      <HojaPago
        pago={pago}
        onCerrar={() => setPago(null)}
        onPagado={() => {
          setPago(null);
          setAvisoPagado(true);
        }}
      />

      {avisoPagado && (
        <div className="hoja-registro__toast" role="status">
          <span aria-hidden="true">✓</span> Pagado
        </div>
      )}

      <HojaRegistro
        abierto={hoja.abierto}
        tipoInicial={hoja.tipo}
        categoriaInicial={hoja.categoria}
        montoInicial={hoja.monto}
        notaInicial={hoja.nota}
        trabajadorInicial={hoja.trabajador}
        sesion={sesion}
        onCerrar={() => setHoja((h) => ({ ...h, abierto: false }))}
      />
    </div>
  );
}
