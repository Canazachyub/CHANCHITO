import { useMemo, useState } from 'react';
import type { Deuda, Prestamo, Sesion, TipoPrestamo } from '../data/types';
import {
  crearPrestamo,
  crearPrestamoCuotaFija,
  editarDeuda,
  finalizarPrestamo,
  registrarPagoDeuda,
  useCuentas,
  usePrestamos,
  type NuevoPrestamo,
} from '../data/api';
import { tceaAproximada } from '../data/tcea';
import ilustracionPrestamos from '../assets/prestamos.webp';
import { cronogramaFrances, repartirPagoCuota, type CuotaCronograma } from '../data/prestamos';
import Modal from '../components/Modal';
import Boton from '../components/Boton';
import CampoMonto from '../components/CampoMonto';
import { diasHasta, formatFechaCorta, formatFechaLarga, formatMoneda } from '../design/format';
import '../components/Formulario.css';
import './Prestamos.css';

interface PrestamosProps {
  sesion: Sesion;
}

const ENTIDADES = ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'BanBif', 'Caja Arequipa', 'Caja Huancayo', 'Mibanco'];

const ETIQUETA_TIPO: Record<TipoPrestamo, string> = {
  prestamo: 'Préstamo',
  tarjeta: 'Tarjeta',
  leasing: 'Leasing',
  otro: 'Otro',
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (s: string) => {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const esCuotaFija = (p: Prestamo) => p.modalidad === 'cuota_fija';
const hoyIso = () => new Date().toISOString().slice(0, 10);

function mensajeError(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto;
}

/** Estado visible de una cuota según su fecha. */
function estadoCuota(c: Deuda, hoy: Date): { texto: string; clase: string } {
  if (c.estado === 'pagada' || c.monto_pendiente <= 0) return { texto: 'Pagada ✓', clase: 'prestamos__estado--pagada' };
  const dias = diasHasta(c.fecha_vencimiento, hoy);
  if (dias < 0) return { texto: 'Vencida', clase: 'prestamos__estado--vencida' };
  if (dias <= 7) return { texto: 'Por vencer', clase: 'prestamos__estado--porvencer' };
  return { texto: 'Pendiente', clase: 'prestamos__estado--pendiente' };
}

function textoDias(dias: number): string {
  if (dias < 0) return `vencida hace ${-dias} d`;
  if (dias === 0) return 'vence hoy';
  return `en ${dias} d`;
}

/* ====================================================================== */
/* Pantalla                                                                */
/* ====================================================================== */

type ItemPrestamo = NonNullable<ReturnType<typeof usePrestamos>>[number];

export default function Prestamos({ sesion }: PrestamosProps) {
  const prestamos = usePrestamos();
  const cuentas = useCuentas();
  const esPropietario = sesion.usuario.rol_global === 'propietario';
  const hoy = useMemo(() => new Date(), []);

  const [expandido, setExpandido] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [cuotaPago, setCuotaPago] = useState<{ cuota: Deuda; cuentaDefecto: string } | null>(null);
  const [aFinalizar, setAFinalizar] = useState<Prestamo | null>(null);

  const activos = (prestamos ?? []).filter((p) => p.prestamo.activo);
  const terminados = (prestamos ?? []).filter((p) => !p.prestamo.activo);

  function tarjeta({ prestamo, cuotas, resumen }: ItemPrestamo) {
    const fija = esCuotaFija(prestamo);
    const vigente = prestamo.activo;
    const abierto = expandido === prestamo.id_prestamo;
    const abiertas = resumen.cuotas_total - resumen.cuotas_pagadas;
    const total = Math.max(prestamo.plazo, resumen.cuotas_total);
    const pagadas = Math.max(0, total - abiertas);
    const pct = total > 0 ? Math.min(100, (pagadas / total) * 100) : 0;
    const prox = vigente ? resumen.proxima : null;
    const diasProx = prox ? diasHasta(prox.fecha, hoy) : 0;
    const claseProx = !prox ? '' : diasProx < 0 ? 'prestamos__prox--vencida' : diasProx <= 7 ? 'prestamos__prox--urgente' : '';
    const cuotaProx = prox ? cuotas.find((c) => c.id_deuda === prox.id_deuda) : undefined;
    const pagadoHastaHoy = r2(cuotas.reduce((s, c) => s + (c.monto_original - c.monto_pendiente), 0));

    return (
      <li key={prestamo.id_prestamo} className={`tarjeta prestamos__tarjeta ${vigente ? '' : 'prestamos__tarjeta--terminada'}`}>
        <div className="prestamos__fila-superior">
          <div>
            <p className="u-headline">{prestamo.entidad}</p>
            <p className="u-footnote">
              {fija ? prestamo.descripcion || 'Préstamo' : prestamo.descripcion || `TEA ${prestamo.tea}% · ${prestamo.plazo} meses`}
            </p>
          </div>
          <div className="prestamos__badges">
            {!vigente && (
              <span className="prestamos__badge prestamos__badge--fin">
                Finalizado el {prestamo.fecha_fin ? formatFechaCorta(prestamo.fecha_fin) : '—'}
              </span>
            )}
            {vigente && resumen.vencidas > 0 && (
              <span className="prestamos__badge prestamos__badge--vencida">
                {resumen.vencidas} {resumen.vencidas === 1 ? 'vencida' : 'vencidas'}
              </span>
            )}
            {fija ? (
              <span className="prestamos__badge prestamos__badge--fija">Cuota fija</span>
            ) : (
              <span className="prestamos__badge">{ETIQUETA_TIPO[prestamo.tipo]}</span>
            )}
          </div>
        </div>

        {fija ? (
          <>
            <p className="u-callout">
              <span className="u-num">{formatMoneda(prestamo.cuota_mensual ?? 0)}</span> cada día {prestamo.dia_pago}
            </p>
            <div className="prestamos__cifras">
              <div>
                <p className="prestamos__rotulo">Pagado hasta hoy</p>
                <p className="prestamos__saldo u-num">{formatMoneda(pagadoHastaHoy)}</p>
              </div>
              <div>
                <p className="prestamos__rotulo">Cuotas pagadas</p>
                <p className="u-amount-md u-num">{resumen.cuotas_pagadas}</p>
              </div>
            </div>
            {prestamo.notas && <p className="u-footnote">{prestamo.notas}</p>}
            <p className="u-footnote">Sin cronograma: capital e interés por completar.</p>
          </>
        ) : (
          <>
            <div className="prestamos__progreso">
              <div
                className="prestamos__barra"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={pagadas}
                aria-label="Cuotas pagadas"
              >
                <div className="prestamos__barra-relleno" style={{ width: `${pct}%` }} />
              </div>
              <p className="u-footnote u-num">
                {pagadas}/{total} cuotas pagadas
              </p>
            </div>

            <div className="prestamos__cifras">
              <div>
                <p className="prestamos__rotulo">Saldo de capital</p>
                <p className="prestamos__saldo u-num">{formatMoneda(resumen.saldo_capital)}</p>
              </div>
              <div>
                <p className="prestamos__rotulo">Total por pagar (con intereses)</p>
                <p className="u-amount-md u-num">{formatMoneda(resumen.total_por_pagar)}</p>
              </div>
              <div>
                <p className="prestamos__rotulo">Intereses por pagar</p>
                <p className="u-amount-md u-num prestamos__interes">{formatMoneda(resumen.intereses_por_pagar)}</p>
              </div>
            </div>
          </>
        )}

        {vigente &&
          (prox ? (
            <div className={`prestamos__prox ${claseProx}`}>
              <div>
                <p className="prestamos__rotulo">Próxima cuota{fija ? '' : ` (N° ${prox.nro})`}</p>
                <p className="u-callout">
                  {formatFechaLarga(prox.fecha)} · <span className="u-num">{formatMoneda(prox.monto)}</span>
                </p>
                <p className="u-footnote prestamos__prox-dias">{textoDias(diasProx)}</p>
              </div>
              {cuotaProx && (
                <Boton
                  variante="primario"
                  tamano="chico"
                  onClick={() => setCuotaPago({ cuota: cuotaProx, cuentaDefecto: prestamo.id_cuenta })}
                >
                  {fija ? 'Pagar' : 'Pagar cuota'}
                </Boton>
              )}
            </div>
          ) : (
            <p className="u-footnote prestamos__prox-dias">Préstamo cancelado: no quedan cuotas pendientes.</p>
          ))}

        <button
          type="button"
          className="prestamos__toggle"
          aria-expanded={abierto}
          onClick={() => setExpandido(abierto ? null : prestamo.id_prestamo)}
        >
          {abierto ? 'Ocultar cuotas ▴' : fija ? 'Ver cuotas ▾' : 'Ver cronograma ▾'}
        </button>

        {abierto && (
          <Cronograma
            cuotas={cuotas}
            hoy={hoy}
            simple={fija}
            soloLectura={!vigente}
            onPagar={(c) => setCuotaPago({ cuota: c, cuentaDefecto: prestamo.id_cuenta })}
          />
        )}

        {vigente && esPropietario && (
          <Boton variante="fantasma" tamano="chico" onClick={() => setAFinalizar(prestamo)}>
            Finalizar préstamo
          </Boton>
        )}
      </li>
    );
  }

  return (
    <section className="prestamos" aria-label="Préstamos bancarios">
      <div className="prestamos__cabecera">
        <h2 className="u-title-2">Préstamos bancarios</h2>
        {esPropietario && (
          <Boton variante="secundario" tamano="chico" onClick={() => setNuevoAbierto(true)}>
            + Nuevo préstamo
          </Boton>
        )}
      </div>

      {prestamos === undefined ? (
        <div className="u-skeleton" style={{ height: 160 }} aria-hidden="true" />
      ) : prestamos.length === 0 ? (
        <div className="tarjeta u-estado-vacio">
          <img className="u-estado-vacio__ilustracion" src={ilustracionPrestamos} alt="" aria-hidden="true" />
          <p className="u-callout">No hay préstamos registrados.</p>
          <p className="u-footnote">
            Registra aquí lo que le debes a un banco: el cronograma de cuotas, cuándo toca pagar cada una y cuánto
            llevas pagado. Al pagar una cuota, el interés y el capital se anotan por separado en tus gastos.
          </p>
        </div>
      ) : (
        <>
          {activos.length > 0 && <ul className="prestamos__lista">{activos.map(tarjeta)}</ul>}
          {terminados.length > 0 && (
            <details className="prestamos__terminados">
              <summary className="prestamos__terminados-resumen">Préstamos terminados ({terminados.length})</summary>
              <ul className="prestamos__lista">{terminados.map(tarjeta)}</ul>
            </details>
          )}
        </>
      )}

      <ModalPagoCuota
        datos={cuotaPago}
        cuentas={cuentas ?? []}
        onCerrar={() => setCuotaPago(null)}
      />
      <ModalFinalizar prestamo={aFinalizar} onCerrar={() => setAFinalizar(null)} />
      {esPropietario && (
        <ModalNuevoPrestamo abierto={nuevoAbierto} cuentas={cuentas ?? []} onCerrar={() => setNuevoAbierto(false)} />
      )}
    </section>
  );
}

/* ====================================================================== */
/* Cronograma de un préstamo                                               */
/* ====================================================================== */

function Cronograma({
  cuotas,
  hoy,
  simple = false,
  soloLectura = false,
  onPagar,
}: {
  cuotas: Deuda[];
  hoy: Date;
  /** Cuota fija: sin columnas de capital / interés / otros. */
  simple?: boolean;
  soloLectura?: boolean;
  onPagar: (c: Deuda) => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [fecha, setFecha] = useState('');
  const [pendiente, setPendiente] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  function editar(c: Deuda) {
    setEditando(c.id_deuda);
    setFecha(c.fecha_vencimiento);
    setPendiente(String(c.monto_pendiente));
    setError(undefined);
  }

  async function guardar(c: Deuda) {
    const p = num(pendiente);
    if (!fecha) return setError('Pon la fecha de vencimiento.');
    if (p < 0) return setError('El pendiente no puede ser negativo.');
    const cambios: { fecha_vencimiento?: string; monto_pendiente?: number } = {};
    if (fecha !== c.fecha_vencimiento) cambios.fecha_vencimiento = fecha;
    if (r2(p) !== c.monto_pendiente) cambios.monto_pendiente = r2(p);
    setGuardando(true);
    try {
      if (Object.keys(cambios).length > 0) await editarDeuda(c.id_deuda, cambios);
      setEditando(null);
    } catch (e) {
      setError(mensajeError(e, 'No se pudo guardar el cambio.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="prestamos__tabla-wrap">
      <table className="prestamos__tabla">
        <thead>
          <tr>
            <th>N°</th>
            <th>Vence</th>
            <th className="prestamos__der">Cuota</th>
            {!simple && (
              <>
                <th className="prestamos__der">Capital</th>
                <th className="prestamos__der">Interés</th>
                <th className="prestamos__der">Otros</th>
              </>
            )}
            <th className="prestamos__der">Pendiente</th>
            <th>Estado</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {cuotas.map((c) => {
            const est = estadoCuota(c, hoy);
            const abierta = !soloLectura && c.estado !== 'pagada' && c.monto_pendiente > 0;
            const enEdicion = editando === c.id_deuda;
            return (
              <tr key={c.id_deuda} className={abierta ? '' : 'prestamos__fila--pagada'}>
                <td className="u-num">{c.nro_cuota}</td>
                <td className="u-num">
                  {enEdicion ? (
                    <input className="form-input prestamos__mini" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Nuevo vencimiento" />
                  ) : (
                    formatFechaCorta(c.fecha_vencimiento)
                  )}
                </td>
                <td className="u-num prestamos__der">{formatMoneda(c.monto_original)}</td>
                {!simple && (
                  <>
                    <td className="u-num prestamos__der">{formatMoneda(c.capital ?? 0)}</td>
                    <td className="u-num prestamos__der">{formatMoneda(c.interes ?? 0)}</td>
                    <td className="u-num prestamos__der">{formatMoneda(c.otros ?? 0)}</td>
                  </>
                )}
                <td className="u-num prestamos__der">
                  {enEdicion ? (
                    <input
                      className="form-input prestamos__mini prestamos__mini--monto u-num"
                      inputMode="decimal"
                      value={pendiente}
                      onChange={(e) => setPendiente(e.target.value.replace(/[^0-9.,]/g, ''))}
                      aria-label="Nuevo pendiente"
                    />
                  ) : (
                    formatMoneda(c.monto_pendiente)
                  )}
                </td>
                <td>
                  <span className={`prestamos__estado ${est.clase}`}>{est.texto}</span>
                </td>
                <td className="prestamos__acciones">
                  {enEdicion ? (
                    <>
                      <Boton variante="primario" tamano="chico" onClick={() => guardar(c)} disabled={guardando}>
                        Guardar
                      </Boton>
                      <Boton variante="fantasma" tamano="chico" onClick={() => setEditando(null)}>
                        Cancelar
                      </Boton>
                    </>
                  ) : (
                    abierta && (
                      <>
                        <Boton variante="secundario" tamano="chico" onClick={() => onPagar(c)}>
                          Pagar
                        </Boton>
                        <Boton variante="fantasma" tamano="chico" onClick={() => editar(c)} aria-label={`Corregir cuota ${c.nro_cuota}`}>
                          Corregir
                        </Boton>
                      </>
                    )
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && (
        <p className="u-footnote prestamos__error" role="alert">
          {error}
        </p>
      )}
      <p className="u-footnote">
        ¿El banco movió una fecha o el monto no coincide? Usa "Corregir" para ajustar vencimiento o pendiente.
      </p>
    </div>
  );
}

/* ====================================================================== */
/* Pagar una cuota                                                         */
/* ====================================================================== */

function ModalPagoCuota({
  datos,
  cuentas,
  onCerrar,
}: {
  datos: { cuota: Deuda; cuentaDefecto: string } | null;
  cuentas: Array<{ id_cuenta: string; nombre: string; icono: string }>;
  onCerrar: () => void;
}) {
  return (
    <Modal abierto={datos !== null} onCerrar={onCerrar} titulo="Pagar cuota">
      {datos && <FormPago key={datos.cuota.id_deuda} cuota={datos.cuota} cuentaDefecto={datos.cuentaDefecto} cuentas={cuentas} onListo={onCerrar} />}
    </Modal>
  );
}

function FormPago({
  cuota,
  cuentaDefecto,
  cuentas,
  onListo,
}: {
  cuota: Deuda;
  cuentaDefecto: string;
  cuentas: Array<{ id_cuenta: string; nombre: string; icono: string }>;
  onListo: () => void;
}) {
  const [monto, setMonto] = useState(String(cuota.monto_pendiente));
  const [cuenta, setCuenta] = useState(cuentaDefecto || cuentas[0]?.id_cuenta || '');
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  const sinDesglose = cuota.capital == null && cuota.interes == null;
  const valor = num(monto);
  const reparto = repartirPagoCuota(cuota, Math.min(Math.max(valor, 0), cuota.monto_pendiente));

  async function confirmar() {
    if (valor <= 0) return setError('Ingresa un monto válido, mayor que cero.');
    if (valor > cuota.monto_pendiente)
      return setError(
        sinDesglose
          ? 'No puede ser mayor que lo pendiente. Si el banco cobró más, corrige antes el monto con "Corregir" en la lista de cuotas.'
          : 'No puede ser mayor que lo pendiente.',
      );
    if (!cuenta) return setError('Elige la cuenta de la que sale el pago.');
    setGuardando(true);
    try {
      await registrarPagoDeuda(cuota.id_deuda, r2(valor), { id_categoria: '', id_cuenta: cuenta });
      onListo();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo registrar el pago.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <p className="u-callout">
        {cuota.persona} · cuota {cuota.nro_cuota} — vence el {formatFechaLarga(cuota.fecha_vencimiento)}
      </p>
      <p className="u-footnote">
        Pendiente de esta cuota: <span className="u-num">{formatMoneda(cuota.monto_pendiente)}</span>. Para un pago parcial, baja el monto.
      </p>
      <CampoMonto valor={monto} onCambiar={(v) => { setMonto(v); setError(undefined); }} autoFocus error={error} />
      <label className="form-campo">
        <span className="u-subhead">Cuenta de pago</span>
        <select className="form-select" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
          <option value="" disabled>Elige una cuenta</option>
          {cuentas.map((c) => (
            <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
          ))}
        </select>
      </label>
      {sinDesglose ? (
        <p className="u-footnote prestamos__reparto">
          Sin cronograma: se registra como un solo pago de cuota. El monto puede variar un poco según lo que cobre el banco.
        </p>
      ) : (
        <p className="u-footnote prestamos__reparto">
          Se registra como <span className="u-num">{formatMoneda(reparto.costo)}</span> de interés y seguro +{' '}
          <span className="u-num">{formatMoneda(reparto.capital)}</span> de capital.
        </p>
      )}
      <Boton variante="primario" bloque onClick={confirmar} disabled={guardando}>
        {guardando ? 'Registrando…' : 'Confirmar pago'}
      </Boton>
    </>
  );
}

/* ====================================================================== */
/* Finalizar un préstamo                                                   */
/* ====================================================================== */

function ModalFinalizar({ prestamo, onCerrar }: { prestamo: Prestamo | null; onCerrar: () => void }) {
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  async function confirmar() {
    if (!prestamo) return;
    setGuardando(true);
    try {
      await finalizarPrestamo(prestamo.id_prestamo);
      onCerrar();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo finalizar el préstamo.'));
    } finally {
      setGuardando(false);
    }
  }

  function cerrar() {
    setError(undefined);
    onCerrar();
  }

  return (
    <Modal abierto={prestamo !== null} onCerrar={cerrar} titulo="Finalizar préstamo">
      {prestamo && (
        <>
          <p className="u-callout">
            {prestamo.entidad}
            {prestamo.descripcion ? ` · ${prestamo.descripcion}` : ''}
          </p>
          <p className="u-body">
            ¿Ese fue el último pago? Se cierra el préstamo y no se generarán más cuotas. Las cuotas futuras que queden
            abiertas se anulan.
          </p>
          {error && (
            <p className="u-footnote prestamos__error" role="alert">
              {error}
            </p>
          )}
          <div className="form-acciones">
            <Boton variante="primario" bloque onClick={confirmar} disabled={guardando}>
              {guardando ? 'Finalizando…' : 'Sí, finalizar préstamo'}
            </Boton>
            <Boton variante="fantasma" bloque onClick={cerrar}>
              Cancelar
            </Boton>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ====================================================================== */
/* Nuevo préstamo (asistente de 2 pasos)                                   */
/* ====================================================================== */

interface FormPrestamo {
  entidad: string;
  tipo: TipoPrestamo;
  descripcion: string;
  monto: string;
  tea: string;
  plazo: string;
  dia_pago: string;
  fecha_desembolso: string;
  otros: string;
  id_cuenta: string;
  notas: string;
  ya_pagadas: string;
}

interface FilaCuota {
  nro: number;
  fecha: string;
  capital: string;
  interes: string;
  otros: string;
}

function formVacio(cuenta: string): FormPrestamo {
  return {
    entidad: '',
    tipo: 'prestamo',
    descripcion: '',
    monto: '',
    tea: '',
    plazo: '12',
    dia_pago: String(new Date().getDate()),
    fecha_desembolso: hoyIso(),
    otros: '',
    id_cuenta: cuenta,
    notas: '',
    ya_pagadas: '0',
  };
}

function dentroDeUltimos31Dias(fecha: string): boolean {
  const d = diasHasta(fecha);
  return d <= 0 && d >= -31;
}

function ModalNuevoPrestamo({
  abierto,
  cuentas,
  onCerrar,
}: {
  abierto: boolean;
  cuentas: Array<{ id_cuenta: string; nombre: string; icono: string }>;
  onCerrar: () => void;
}) {
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Nuevo préstamo">
      <ElegirModalidad cuentas={cuentas} onListo={onCerrar} />
    </Modal>
  );
}

function ElegirModalidad({
  cuentas,
  onListo,
}: {
  cuentas: Array<{ id_cuenta: string; nombre: string; icono: string }>;
  onListo: () => void;
}) {
  const [modo, setModo] = useState<'cronograma' | 'cuota_fija' | null>(null);
  if (modo === 'cronograma') return <AsistentePrestamo cuentas={cuentas} onListo={onListo} />;
  if (modo === 'cuota_fija') return <FormCuotaFija cuentas={cuentas} onListo={onListo} onVolver={() => setModo(null)} />;
  return (
    <>
      <p className="u-callout">¿Tienes el cronograma del banco?</p>
      <div className="form-acciones">
        <Boton variante="primario" bloque onClick={() => setModo('cronograma')}>
          Sí, tengo monto, plazo y TEA
        </Boton>
        <Boton variante="secundario" bloque onClick={() => setModo('cuota_fija')}>
          No, solo sé la cuota mensual
        </Boton>
      </div>
      <p className="u-footnote">
        Sin cronograma, la app genera una cuota cada mes (con el monto y el día que indiques) hasta que pulses
        "Finalizar préstamo".
      </p>
    </>
  );
}

function FormCuotaFija({
  cuentas,
  onListo,
  onVolver,
}: {
  cuentas: Array<{ id_cuenta: string; nombre: string; icono: string }>;
  onListo: () => void;
  onVolver: () => void;
}) {
  const [entidad, setEntidad] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [titular, setTitular] = useState('');
  const [cuota, setCuota] = useState('');
  const [dia, setDia] = useState(String(new Date().getDate()));
  const [proxima, setProxima] = useState(hoyIso());
  const [cuenta, setCuenta] = useState(cuentas[0]?.id_cuenta ?? '');
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  const cuentaEfectiva = cuenta || cuentas[0]?.id_cuenta || '';

  async function guardar() {
    const d = Math.floor(num(dia));
    if (!entidad.trim()) return setError('Indica el banco o entidad.');
    if (num(cuota) <= 0) return setError('La cuota mensual debe ser mayor que cero.');
    if (d < 1 || d > 31) return setError('El día de pago debe estar entre 1 y 31.');
    if (!proxima) return setError('Indica la fecha de la próxima cuota.');
    if (!cuentaEfectiva) return setError('Elige la cuenta de pago.');
    setGuardando(true);
    try {
      await crearPrestamoCuotaFija({
        entidad: entidad.trim(),
        descripcion: descripcion.trim(),
        cuota_mensual: r2(num(cuota)),
        dia_pago: d,
        proximo_vencimiento: proxima,
        id_cuenta: cuentaEfectiva,
        notas: titular.trim() ? `Titular: ${titular.trim()}` : '',
      });
      onListo();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo guardar el préstamo.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <p className="u-footnote prestamos__paso">Préstamo sin cronograma · solo la cuota mensual</p>

      <label className="form-campo">
        <span className="u-subhead">Banco o entidad</span>
        <input className="form-input" type="text" list="prestamos-entidades-fija" value={entidad} onChange={(e) => { setEntidad(e.target.value); setError(undefined); }} placeholder="Ej. Mibanco" maxLength={80} />
        <datalist id="prestamos-entidades-fija">
          {ENTIDADES.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
      </label>

      <label className="form-campo">
        <span className="u-subhead">Descripción (opcional)</span>
        <input className="form-input" type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Préstamo de Lourdes" maxLength={120} />
      </label>

      <label className="form-campo">
        <span className="u-subhead">Titular (opcional)</span>
        <input className="form-input" type="text" value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="A nombre de quién está" maxLength={80} />
      </label>

      <CampoMonto etiqueta="Cuota mensual" valor={cuota} onCambiar={(v) => { setCuota(v); setError(undefined); }} />

      <div className="prestamos__dos">
        <label className="form-campo">
          <span className="u-subhead">Día de pago</span>
          <input className="form-input u-num" inputMode="numeric" value={dia} onChange={(e) => { setDia(e.target.value.replace(/\D/g, '').slice(0, 2)); setError(undefined); }} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">Próxima cuota</span>
          <input className="form-input" type="date" value={proxima} onChange={(e) => { setProxima(e.target.value); setError(undefined); }} />
        </label>
      </div>

      <label className="form-campo">
        <span className="u-subhead">Cuenta de pago</span>
        <select className="form-select" value={cuentaEfectiva} onChange={(e) => setCuenta(e.target.value)}>
          <option value="" disabled>Elige una cuenta</option>
          {cuentas.map((c) => (
            <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
          ))}
        </select>
      </label>

      {error && (
        <p className="u-footnote prestamos__error" role="alert">
          {error}
        </p>
      )}
      <div className="form-acciones">
        <Boton variante="primario" bloque onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar préstamo'}
        </Boton>
        <Boton variante="fantasma" bloque onClick={onVolver}>
          Volver
        </Boton>
      </div>
    </>
  );
}

function AsistentePrestamo({
  cuentas,
  onListo,
}: {
  cuentas: Array<{ id_cuenta: string; nombre: string; icono: string }>;
  onListo: () => void;
}) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormPrestamo>(() => formVacio(cuentas[0]?.id_cuenta ?? ''));
  // null = sin tocar: el valor sale de la fecha de desembolso.
  const [desembolsoManual, setDesembolsoManual] = useState<boolean | null>(null);
  const [filas, setFilas] = useState<FilaCuota[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  const cuentaEfectiva = form.id_cuenta || cuentas[0]?.id_cuenta || '';
  const desembolsoEnCuenta = desembolsoManual ?? dentroDeUltimos31Dias(form.fecha_desembolso);
  const campo = <K extends keyof FormPrestamo>(k: K, v: FormPrestamo[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(undefined);
  };

  function generar(): FilaCuota[] {
    return cronogramaFrances({
      monto: num(form.monto),
      tea: num(form.tea),
      plazo: Math.floor(num(form.plazo)),
      fechaDesembolso: form.fecha_desembolso,
      diaPago: Math.floor(num(form.dia_pago)),
      otrosMensual: num(form.otros),
    }).map((c) => ({ nro: c.nro, fecha: c.fecha, capital: String(c.capital), interes: String(c.interes), otros: String(c.otros) }));
  }

  function irAlPaso2() {
    if (!form.entidad.trim()) return setError('Indica el banco o entidad.');
    if (num(form.monto) <= 0) return setError('El monto desembolsado debe ser mayor que cero.');
    if (num(form.tea) < 0) return setError('La TEA no puede ser negativa.');
    const plazo = Math.floor(num(form.plazo));
    if (plazo < 1 || plazo > 600) return setError('El plazo debe ser de 1 a 600 meses.');
    const dia = Math.floor(num(form.dia_pago));
    if (dia < 1 || dia > 31) return setError('El día de pago debe estar entre 1 y 31.');
    if (!form.fecha_desembolso) return setError('Indica la fecha de desembolso.');
    const ya = Math.floor(num(form.ya_pagadas));
    if (ya < 0 || ya >= plazo) return setError('Las cuotas ya pagadas deben ser menos que el plazo.');
    if (!cuentaEfectiva) return setError('Elige la cuenta de pago.');
    setFilas(generar());
    setError(undefined);
    setPaso(2);
  }

  const yaPagadas = Math.floor(num(form.ya_pagadas));
  const calculadas = filas.map((f) => ({
    ...f,
    cap: num(f.capital),
    int: num(f.interes),
    otr: num(f.otros),
    cuota: r2(num(f.capital) + num(f.interes) + num(f.otros)),
  }));
  const sumCapital = r2(calculadas.reduce((s, f) => s + f.cap, 0));
  const sumInteres = r2(calculadas.reduce((s, f) => s + f.int, 0));
  const sumOtros = r2(calculadas.reduce((s, f) => s + f.otr, 0));
  const diferencia = r2(sumCapital - num(form.monto));
  const cuadra = Math.abs(diferencia) < 0.005;

  const prestado = num(form.monto);
  const totalAPagar = r2(sumCapital + sumInteres + sumOtros);
  const pagasDeMas = r2(totalAPagar - prestado);
  const pctSobre = prestado > 0 ? (pagasDeMas / prestado) * 100 : 0;
  const cuotaPromedio = calculadas.length > 0 ? r2(totalAPagar / calculadas.length) : 0;
  const tcea = tceaAproximada(prestado, calculadas.map((f) => f.cuota));

  function cambiarFila(i: number, k: 'fecha' | 'capital' | 'interes' | 'otros', v: string) {
    const limpio = k === 'fecha' ? v : v.replace(/[^0-9.,]/g, '');
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: limpio } : f)));
    setError(undefined);
  }

  async function guardar() {
    if (calculadas.some((f) => !f.fecha)) return setError('Todas las cuotas necesitan fecha.');
    if (calculadas.some((f) => f.cuota <= 0 && f.nro > yaPagadas)) return setError('Hay cuotas con monto cero: revisa el cronograma.');
    const datos: NuevoPrestamo = {
      entidad: form.entidad.trim(),
      tipo: form.tipo,
      descripcion: form.descripcion.trim(),
      monto: r2(num(form.monto)),
      tea: num(form.tea),
      plazo: Math.floor(num(form.plazo)),
      dia_pago: Math.floor(num(form.dia_pago)),
      fecha_desembolso: form.fecha_desembolso,
      id_cuenta: cuentaEfectiva,
      notas: form.notas.trim(),
    };
    const cuotas: CuotaCronograma[] = calculadas.map((f, i, todas) => {
      const saldo = r2(todas.slice(i + 1).reduce((s, x) => s + x.cap, 0));
      return { nro: f.nro, fecha: f.fecha, cuota: f.cuota, capital: r2(f.cap), interes: r2(f.int), otros: r2(f.otr), saldo };
    });
    setGuardando(true);
    try {
      await crearPrestamo(datos, cuotas, {
        cuotasYaPagadas: yaPagadas,
        desembolsoEnCuenta: desembolsoEnCuenta ? cuentaEfectiva : undefined,
      });
      onListo();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo guardar el préstamo.'));
    } finally {
      setGuardando(false);
    }
  }

  if (paso === 1) {
    return (
      <>
        <p className="u-footnote prestamos__paso">Paso 1 de 2 · Datos del préstamo</p>

        <label className="form-campo">
          <span className="u-subhead">Banco o entidad</span>
          <input className="form-input" type="text" list="prestamos-entidades" value={form.entidad} onChange={(e) => campo('entidad', e.target.value)} placeholder="Ej. BCP" maxLength={80} />
          <datalist id="prestamos-entidades">
            {ENTIDADES.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>

        <div className="form-tipo" role="group" aria-label="Tipo">
          {(Object.keys(ETIQUETA_TIPO) as TipoPrestamo[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`form-chip-tipo ${form.tipo === t ? 'form-chip-tipo--activo-ingreso' : ''}`}
              aria-pressed={form.tipo === t}
              onClick={() => campo('tipo', t)}
            >
              {ETIQUETA_TIPO[t]}
            </button>
          ))}
        </div>

        <label className="form-campo">
          <span className="u-subhead">Descripción (opcional)</span>
          <input className="form-input" type="text" value={form.descripcion} onChange={(e) => campo('descripcion', e.target.value)} placeholder="Ej. Capital de trabajo" maxLength={120} />
        </label>

        <CampoMonto etiqueta="Monto desembolsado" valor={form.monto} onCambiar={(v) => campo('monto', v)} />

        <div className="prestamos__dos">
          <label className="form-campo">
            <span className="u-subhead">TEA (%)</span>
            <input className="form-input u-num" inputMode="decimal" value={form.tea} onChange={(e) => campo('tea', e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="18" />
          </label>
          <label className="form-campo">
            <span className="u-subhead">Plazo (meses)</span>
            <input className="form-input u-num" inputMode="numeric" value={form.plazo} onChange={(e) => campo('plazo', e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>

        <div className="prestamos__dos">
          <label className="form-campo">
            <span className="u-subhead">Día de pago</span>
            <input className="form-input u-num" inputMode="numeric" value={form.dia_pago} onChange={(e) => campo('dia_pago', e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </label>
          <label className="form-campo">
            <span className="u-subhead">Fecha de desembolso</span>
            <input className="form-input" type="date" value={form.fecha_desembolso} onChange={(e) => campo('fecha_desembolso', e.target.value)} />
          </label>
        </div>

        <label className="form-campo">
          <span className="u-subhead">Seguro / otros mensual (S/, opcional)</span>
          <input className="form-input u-num" inputMode="decimal" value={form.otros} onChange={(e) => campo('otros', e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0.00" />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Cuenta de pago</span>
          <select className="form-select" value={cuentaEfectiva} onChange={(e) => campo('id_cuenta', e.target.value)}>
            <option value="" disabled>Elige una cuenta</option>
            {cuentas.map((c) => (
              <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
            ))}
          </select>
        </label>

        <label className="form-campo">
          <span className="u-subhead">Cuotas ya pagadas</span>
          <input className="form-input u-num" inputMode="numeric" value={form.ya_pagadas} onChange={(e) => campo('ya_pagadas', e.target.value.replace(/\D/g, ''))} />
          <span className="u-footnote">Si el préstamo empezó antes, esas cuotas no se registran como pendientes.</span>
        </label>

        <label className="form-campo">
          <span className="u-subhead">Notas (opcional)</span>
          <input className="form-input" type="text" value={form.notas} onChange={(e) => campo('notas', e.target.value)} maxLength={200} />
        </label>

        <label className="form-check">
          <input type="checkbox" checked={desembolsoEnCuenta} onChange={(e) => setDesembolsoManual(e.target.checked)} />
          <span className="u-subhead">Registrar el desembolso como ingreso en la cuenta</span>
        </label>

        {error && (
          <p className="u-footnote prestamos__error" role="alert">
            {error}
          </p>
        )}
        <Boton variante="primario" bloque onClick={irAlPaso2}>
          Siguiente: cronograma
        </Boton>
      </>
    );
  }

  return (
    <>
      <p className="u-footnote prestamos__paso">Paso 2 de 2 · Cronograma</p>
      <p className="u-callout prestamos__nota">
        Copia aquí el cronograma del banco: manda el papel del banco. Este cálculo es una aproximación y casi nunca
        coincide al centavo. Toca cualquier celda para corregirla.
      </p>

      <div className="prestamos__tabla-wrap">
        <table className="prestamos__tabla prestamos__tabla--edicion">
          <thead>
            <tr>
              <th>N°</th>
              <th>Fecha</th>
              <th className="prestamos__der">Capital</th>
              <th className="prestamos__der">Interés</th>
              <th className="prestamos__der">Otros</th>
              <th className="prestamos__der">Cuota</th>
            </tr>
          </thead>
          <tbody>
            {calculadas.map((f, i) => {
              const pagada = f.nro <= yaPagadas;
              return (
                <tr key={f.nro} className={pagada ? 'prestamos__fila--pagada' : ''}>
                  <td className="u-num">
                    {f.nro}
                    {pagada && <span className="prestamos__ya"> ya pagada</span>}
                  </td>
                  <td>
                    <input className="form-input prestamos__mini" type="date" value={f.fecha} onChange={(e) => cambiarFila(i, 'fecha', e.target.value)} aria-label={`Fecha cuota ${f.nro}`} />
                  </td>
                  {(['capital', 'interes', 'otros'] as const).map((k) => (
                    <td key={k}>
                      <input
                        className="form-input prestamos__mini prestamos__mini--monto u-num"
                        inputMode="decimal"
                        value={filas[i][k]}
                        onChange={(e) => cambiarFila(i, k, e.target.value)}
                        aria-label={`${k} cuota ${f.nro}`}
                      />
                    </td>
                  ))}
                  <td className="u-num prestamos__der">{formatMoneda(f.cuota)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="prestamos__demas" aria-label="Cuánto pagas de más">
        <p className="u-subhead">¿Cuánto pagas de más?</p>
        <div className="prestamos__demas-fila">
          <span>Prestado</span>
          <span className="u-num">{formatMoneda(prestado)}</span>
        </div>
        <div className="prestamos__demas-fila">
          <span>Total a pagar</span>
          <span className="u-num">{formatMoneda(totalAPagar)}</span>
        </div>
        <div className="prestamos__demas-fila prestamos__demas-fila--destacada">
          <span>Pagas de más</span>
          <span className="u-num">{formatMoneda(pagasDeMas)}</span>
        </div>
        <p className="u-footnote">
          Intereses{sumOtros > 0 ? ' y seguros u otros' : ''} · <span className="u-num">{pctSobre.toFixed(1)}%</span> sobre lo prestado
        </p>
        <p className="u-footnote">
          TCEA aproximada: <span className="u-num">{tcea === null ? '—' : `${tcea.toFixed(2)}%`}</span> · Cuota promedio:{' '}
          <span className="u-num">{formatMoneda(cuotaPromedio)}</span>
        </p>
      </div>

      <div className="prestamos__totales">
        <p className="u-footnote">
          Σ Capital: <span className="u-num">{formatMoneda(sumCapital)}</span>{' '}
          {cuadra ? (
            <span className="prestamos__ok">✓ cuadra con el monto</span>
          ) : (
            <span className="prestamos__aviso">
              ⚠ {diferencia > 0 ? 'sobra' : 'falta'} <span className="u-num">{formatMoneda(Math.abs(diferencia))}</span> respecto al monto
            </span>
          )}
        </p>
        <p className="u-footnote">
          Σ Intereses (costo del crédito): <span className="u-num">{formatMoneda(sumInteres)}</span>
          {sumOtros > 0 && (
            <>
              {' '}· Seguros y otros: <span className="u-num">{formatMoneda(sumOtros)}</span>
            </>
          )}
        </p>
        <p className="u-footnote">
          Total a pagar al banco: <span className="u-num">{formatMoneda(r2(sumCapital + sumInteres + sumOtros))}</span>
        </p>
      </div>

      {error && (
        <p className="u-footnote prestamos__error" role="alert">
          {error}
        </p>
      )}

      <div className="form-acciones">
        <Boton variante="primario" bloque onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar préstamo'}
        </Boton>
        <Boton variante="secundario" bloque onClick={() => setFilas(generar())}>
          Recalcular desde la fórmula
        </Boton>
        <Boton variante="fantasma" bloque onClick={() => { setPaso(1); setError(undefined); }}>
          Volver a los datos
        </Boton>
      </div>
    </>
  );
}
