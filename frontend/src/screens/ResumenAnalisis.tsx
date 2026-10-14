import { useState } from 'react';
import { exportarCsvMes, useAnalisisMes } from '../data/api';
import type { FichaTrabajador } from '../data/analisis';
import Ranking from '../components/graficos/Ranking';
import Boton from '../components/Boton';
import { formatFechaCorta, formatMoneda, iniciales } from '../design/format';
import './ResumenAnalisis.css';

/** Mismo mapeo que Resumen.tsx (CONTRACT § 6-bis). */
const ETIQUETA_GRUPO: Record<string, string> = {
  operativos: 'Operativos',
  personal: 'Personal',
  activos: 'Activos fijos',
  impuestos: 'Impuestos',
  ingresos: 'Ingresos',
  '': 'Otros',
};

/** Contratos que vencen dentro de esta ventana se marcan para renovar a tiempo. */
const DIAS_AVISO_CONTRATO = 45;
/** Por debajo de esto una variación es ruido (un menú más caro, una carrera de taxi). */
const VARIACION_MINIMA = 0.15;

function porcentaje(valor: number): string {
  return `${Math.round(valor * 100)}%`;
}

function descargar(nombre: string, contenido: string) {
  // BOM para que Excel abra las tildes bien en vez de "NotarÃ­a".
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResumenAnalisis({ mes, anio }: { mes: number; anio: number }) {
  const analisis = useAnalisisMes(mes, anio);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  if (analisis === undefined) {
    return <div className="u-skeleton" style={{ height: 160 }} aria-hidden="true" />;
  }

  const { indicadores: ind, por_persona, variaciones, fichas, cuentas, mes_en_curso } = analisis;
  const relevantes = variaciones
    .filter((v) => v.variacion === null ? v.actual > 0 : Math.abs(v.variacion) >= VARIACION_MINIMA)
    .slice(0, 5);
  const totalPorPagar = fichas.reduce((s, f) => s + f.por_pagar, 0);

  async function exportar() {
    setExportando(true);
    try {
      const { nombre, contenido } = await exportarCsvMes(mes, anio);
      descargar(nombre, contenido);
    } finally {
      setExportando(false);
    }
  }

  return (
    <>
      <section className="tarjeta analisis" aria-label="Indicadores del mes">
        <h2 className="u-title-3">Indicadores</h2>
        <div className="analisis__kpis">
          <div className="analisis__kpi">
            <span className="u-footnote">Queda de lo que entró</span>
            <span className={`u-amount u-num ${ind.tasa_ahorro !== null && ind.tasa_ahorro < 0 ? 'u-expense' : ''}`}>
              {ind.tasa_ahorro === null ? '—' : porcentaje(ind.tasa_ahorro)}
            </span>
          </div>
          {ind.ratio_personal !== null && (
            <div className="analisis__kpi">
              <span className="u-footnote">Personal / ingresos</span>
              <span className="u-amount u-num">{porcentaje(ind.ratio_personal)}</span>
              <span className="u-caption u-num">{formatMoneda(ind.costo_personal)}</span>
            </div>
          )}
          {ind.obligaciones.cantidad > 0 && (
            <div className="analisis__kpi">
              <span className="u-footnote">Obligaciones pagadas</span>
              <span className="u-amount u-num">{porcentaje(ind.obligaciones.estimado > 0 ? ind.obligaciones.pagado / ind.obligaciones.estimado : 0)}</span>
              <span className="u-caption u-num">Faltan {formatMoneda(ind.obligaciones.pendiente)}</span>
            </div>
          )}
        </div>

        {ind.gasto_por_grupo.length > 1 && (
          <ul className="analisis__barras">
            {ind.gasto_por_grupo.map((g) => (
              <li key={g.grupo || '_'} className="analisis__barra-fila">
                <span className="u-footnote analisis__barra-nombre">{ETIQUETA_GRUPO[g.grupo] ?? g.grupo}</span>
                <span className="analisis__barra" aria-hidden="true">
                  <span className="analisis__barra-relleno" style={{ width: porcentaje(g.proporcion) }} />
                </span>
                <span className="u-footnote u-num">{formatMoneda(g.total)}</span>
              </li>
            ))}
          </ul>
        )}

        {ind.personal_sin_asignar.cantidad > 0 && (
          <p className="u-footnote analisis__aviso">
            {ind.personal_sin_asignar.cantidad} pago{ind.personal_sin_asignar.cantidad === 1 ? '' : 's'} de personal por{' '}
            {formatMoneda(ind.personal_sin_asignar.total)} sin trabajador asignado. Edítalos en Gastos para que entren en la ficha de cada uno.
          </p>
        )}
      </section>

      {fichas.length > 0 && (
        <section className="tarjeta analisis" aria-label="Pagos por trabajador">
          <div className="analisis__cabecera">
            <h2 className="u-title-3">Personal</h2>
            {totalPorPagar > 0 && <span className="u-footnote u-num">Por pagar {formatMoneda(totalPorPagar)}</span>}
          </div>
          <ul className="analisis__lista">
            {fichas.map((f) => (
              <FilaTrabajador
                key={f.trabajador.id_trabajador}
                ficha={f}
                anio={anio}
                abierto={abierto === f.trabajador.id_trabajador}
                onAlternar={() => setAbierto((a) => (a === f.trabajador.id_trabajador ? null : f.trabajador.id_trabajador))}
              />
            ))}
          </ul>
        </section>
      )}

      {por_persona.length > 0 && (
        <section className="tarjeta analisis" aria-label="Movimientos por persona">
          <h2 className="u-title-3">Por persona</h2>
          <p className="u-footnote">Quién registró o hizo cada gasto. Top 5 por monto.</p>
          <Ranking
            items={por_persona.map((p) => ({
              id: p.id_usuario || '_',
              nombre: p.nombre,
              monto: formatMoneda(p.gastos),
              proporcion: por_persona[0].gastos > 0 ? p.gastos / por_persona[0].gastos : 0,
              detalle: (
                <>
                  {p.movimientos} mov.
                  {p.categoria_principal && ` · más en ${p.categoria_principal.icono} ${p.categoria_principal.nombre}`}
                  {p.ingresos > 0 && ` · ingresó ${formatMoneda(p.ingresos)}`}
                </>
              ),
            }))}
          />
        </section>
      )}

      {relevantes.length > 0 && (
        <section className="tarjeta analisis" aria-label="Cambios frente a meses anteriores">
          <h2 className="u-title-3">Qué cambió</h2>
          <p className="u-footnote">
            Contra el promedio de los 3 meses anteriores{mes_en_curso ? ', ajustado a los días que van del mes' : ''}.
          </p>
          <ul className="analisis__lista">
            {relevantes.map((v) => {
              const sube = v.variacion === null || v.variacion > 0;
              return (
                <li key={v.id_categoria} className="analisis__fila">
                  <span className="analisis__icono" aria-hidden="true">{v.icono}</span>
                  <div className="analisis__info">
                    <span className="u-callout">{v.nombre}</span>
                    <span className="u-footnote u-num">
                      {formatMoneda(v.actual)} {v.variacion === null ? '· nuevo este período' : `vs ${formatMoneda(v.esperado)} habitual`}
                    </span>
                  </div>
                  <span className={`u-subhead u-num analisis__variacion ${sube ? 'u-expense' : 'u-income'}`}>
                    {v.variacion === null ? 'nuevo' : `${sube ? '▲' : '▼'} ${porcentaje(Math.abs(v.variacion))}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {cuentas.length > 0 && (
        <section className="tarjeta analisis" aria-label="Saldo por cuenta">
          <h2 className="u-title-3">Cuentas</h2>
          <ul className="analisis__lista">
            {cuentas.map((c) => (
              <li key={c.cuenta.id_cuenta} className="analisis__fila">
                <span className="analisis__icono" aria-hidden="true">{c.cuenta.icono}</span>
                <div className="analisis__info">
                  <span className="u-callout">{c.cuenta.nombre}</span>
                  <span className={`u-footnote u-num ${c.neto_mes < 0 ? 'u-expense' : ''}`}>
                    Este mes {c.neto_mes >= 0 ? '+' : '−'}{formatMoneda(Math.abs(c.neto_mes))}
                  </span>
                </div>
                <span className={`u-amount u-num ${c.saldo < 0 ? 'u-expense' : ''}`}>{formatMoneda(c.saldo)}</span>
              </li>
            ))}
          </ul>
          <p className="u-caption analisis__nota">No incluye transferencias entre cuentas.</p>
        </section>
      )}

      <Boton variante="secundario" bloque onClick={exportar} disabled={exportando}>
        {exportando ? 'Preparando…' : 'Exportar movimientos del mes (CSV)'}
      </Boton>
    </>
  );
}

function FilaTrabajador({
  ficha: f,
  anio,
  abierto,
  onAlternar,
}: {
  ficha: FichaTrabajador;
  anio: number;
  abierto: boolean;
  onAlternar: () => void;
}) {
  const t = f.trabajador;
  const vencePronto = f.dias_para_fin !== null && f.dias_para_fin <= DIAS_AVISO_CONTRATO;
  return (
    <li className="analisis__trabajador">
      <button type="button" className="analisis__fila analisis__fila-boton" onClick={onAlternar} aria-expanded={abierto}>
        <span className="analisis__avatar" aria-hidden="true">{iniciales(t.nombre)}</span>
        <div className="analisis__info">
          <span className="u-callout">
            {t.nombre}
            {!t.activo && <span className="analisis__badge analisis__badge--gris">De baja</span>}
          </span>
          <span className="u-footnote">
            {[t.cargo, t.proyecto, t.tipo_vinculo === 'honorarios' ? 'Honorarios' : 'Planilla'].filter(Boolean).join(' · ')}
          </span>
          <span className="analisis__badges">
            {vencePronto && (
              <span className="analisis__badge analisis__badge--alerta">
                {f.dias_para_fin! < 0 ? 'Contrato vencido' : `Contrato vence en ${f.dias_para_fin} d`}
              </span>
            )}
            {f.por_pagar > 0 && <span className="analisis__badge analisis__badge--alerta">Por pagar {formatMoneda(f.por_pagar)}</span>}
            {f.adelantos_pendientes > 0 && (
              <span className="analisis__badge">Adelanto por descontar {formatMoneda(f.adelantos_pendientes)}</span>
            )}
          </span>
        </div>
        <span className="u-amount u-num">{formatMoneda(f.total_mes)}</span>
      </button>

      {abierto && (
        <div className="analisis__detalle">
          <dl className="analisis__datos">
            <div><dt className="u-caption">Pagado en {anio}</dt><dd className="u-subhead u-num">{formatMoneda(f.total_anio)}</dd></div>
            <div><dt className="u-caption">Meses con pago</dt><dd className="u-subhead u-num">{f.meses_con_pago}</dd></div>
            <div><dt className="u-caption">Sueldo base</dt><dd className="u-subhead u-num">{t.sueldo_base ? formatMoneda(t.sueldo_base) : '—'}</dd></div>
            <div><dt className="u-caption">Último pago</dt><dd className="u-subhead">{f.ultimo_pago ? formatFechaCorta(f.ultimo_pago) : '—'}</dd></div>
            <div><dt className="u-caption">Contrato</dt><dd className="u-subhead">
              {t.fecha_ingreso ? formatFechaCorta(t.fecha_ingreso) : '¿?'} → {t.fecha_fin ? formatFechaCorta(t.fecha_fin) : 'indefinido'}
            </dd></div>
            <div><dt className="u-caption">Pensión</dt><dd className="u-subhead">{t.pension || 'Sin dato'}</dd></div>
          </dl>
          {f.por_categoria.length > 0 ? (
            <ul className="analisis__desglose">
              {f.por_categoria.map((c) => (
                <li key={c.id_categoria} className="analisis__desglose-fila">
                  <span className="u-footnote">{c.icono} {c.nombre}</span>
                  <span className="u-footnote u-num">{formatMoneda(c.total)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="u-footnote">Sin pagos registrados en {anio}.</p>
          )}
        </div>
      )}
    </li>
  );
}
