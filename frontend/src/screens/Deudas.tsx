import { useMemo, useState } from 'react';
import type { Deuda, EstadoSolicitud, Sesion, SolicitudDinero } from '../data/types';
import {
  crearDeuda,
  crearSolicitud,
  registrarPagoDeuda,
  responderSolicitud,
  useCategorias,
  useCuentas,
  useDeudas,
  useObligaciones,
  useSolicitudes,
  useUsuarios,
  type NuevaDeuda,
  type NuevaSolicitud,
} from '../data/api';
import Modal from '../components/Modal';
import Boton from '../components/Boton';
import CampoMonto from '../components/CampoMonto';
import Prestamos from './Prestamos';
import SelectorEspacio from '../components/SelectorEspacio';
import { diasHasta, formatFechaLarga, formatMoneda } from '../design/format';
import { PREFIJO_DEUDA_OBLIGACION } from '../data/analisis';
import ilustracionDeudas from '../assets/deudas.webp';
import ilustracionSolicitudes from '../assets/solicitudes.webp';
import '../components/Formulario.css';
import './Deudas.css';

interface DeudasProps {
  sesion: Sesion;
}

interface FormularioDeuda {
  tipo: 'me_deben' | 'debo';
  persona: string;
  monto_original: string;
  descripcion: string;
  fecha_vencimiento: string;
}

interface FormularioSolicitud {
  monto: string;
  motivo: string;
  id_categoria: string;
}

function formularioVacio(): FormularioDeuda {
  const enUnMes = new Date();
  enUnMes.setMonth(enUnMes.getMonth() + 1);
  return {
    tipo: 'me_deben',
    persona: '',
    monto_original: '',
    descripcion: '',
    fecha_vencimiento: enUnMes.toISOString().slice(0, 10),
  };
}

function formularioSolicitudVacio(): FormularioSolicitud {
  return { monto: '', motivo: '', id_categoria: '' };
}

function etiquetaEstado(d: Deuda, dias: number): { texto: string; clase: string } {
  if (d.estado === 'pagada') return { texto: 'Pagada', clase: 'deudas__badge--pagada' };
  if (d.estado === 'vencida' || dias < 0) return { texto: 'Vencida', clase: 'deudas__badge--vencida' };
  if (dias <= 3) return { texto: dias === 0 ? 'Vence hoy' : `Vence en ${dias}d`, clase: 'deudas__badge--urgente' };
  return { texto: 'Pendiente', clase: 'deudas__badge--pendiente' };
}

const ETIQUETA_ESTADO_SOLICITUD: Record<EstadoSolicitud, { texto: string; clase: string }> = {
  solicitada: { texto: 'Pendiente', clase: 'deudas__badge--pendiente' },
  aprobada: { texto: 'Aprobada', clase: 'deudas__badge--pagada' },
  rechazada: { texto: 'Rechazada', clase: 'deudas__badge--vencida' },
};

/** Mensaje de error de la capa de datos (ej. "requiere conexión") no siempre es un Error real. */
function mensajeError(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto;
}

export default function Deudas({ sesion }: DeudasProps) {
  const deudas = useDeudas();
  const solicitudes = useSolicitudes();
  const categoriasGasto = useCategorias('gasto');
  const categoriasIngreso = useCategorias('ingreso');
  const cuentas = useCuentas();
  const obligaciones = useObligaciones();
  const usuarios = useUsuarios();
  const esPropietario = sesion.usuario.rol_global === 'propietario';

  const [modalNuevaAbierto, setModalNuevaAbierto] = useState(false);
  const [formNueva, setFormNueva] = useState<FormularioDeuda>(formularioVacio());
  const [errorNueva, setErrorNueva] = useState<string | undefined>();
  const [guardandoNueva, setGuardandoNueva] = useState(false);

  const [deudaPago, setDeudaPago] = useState<Deuda | null>(null);
  const [montoPago, setMontoPago] = useState('');
  const [errorPago, setErrorPago] = useState<string | undefined>();
  const [guardandoPago, setGuardandoPago] = useState(false);
  // Registrar el pago también como gasto/ingreso real (ver registrarPagoDeuda en data/api.ts).
  const [conMovimiento, setConMovimiento] = useState(true);
  const [categoriaPago, setCategoriaPago] = useState('');
  const [cuentaPago, setCuentaPago] = useState('');

  const [modalSolicitudAbierto, setModalSolicitudAbierto] = useState(false);
  const [formSolicitud, setFormSolicitud] = useState<FormularioSolicitud>(formularioSolicitudVacio());
  const [errorSolicitud, setErrorSolicitud] = useState<string | undefined>();
  const [guardandoSolicitud, setGuardandoSolicitud] = useState(false);

  const [respondiendo, setRespondiendo] = useState<{ solicitud: SolicitudDinero; aprobar: boolean } | null>(null);
  const [motivoRespuesta, setMotivoRespuesta] = useState('');
  const [errorRespuesta, setErrorRespuesta] = useState<string | undefined>();
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);

  const hoy = useMemo(() => new Date(), []);

  const listaOrdenada = useMemo(() => {
    if (!deudas) return undefined;
    return deudas
      .filter((d) => !d.id_prestamo) // las cuotas de préstamos se ven dentro de su préstamo
      .sort((a, b) => {
      if (a.estado === 'pagada' && b.estado !== 'pagada') return 1;
      if (b.estado === 'pagada' && a.estado !== 'pagada') return -1;
      return a.fecha_vencimiento < b.fecha_vencimiento ? -1 : 1;
    });
  }, [deudas]);

  const usuarioPorId = useMemo(() => new Map((usuarios ?? []).map((u) => [u.id_usuario, u])), [usuarios]);
  const pendientesDeResponder = useMemo(
    () => (solicitudes ?? []).filter((s) => s.estado === 'solicitada'),
    [solicitudes],
  );
  const misSolicitudes = useMemo(
    () => (solicitudes ?? []).filter((s) => s.id_solicitante === sesion.usuario.id_usuario),
    [solicitudes, sesion.usuario.id_usuario],
  );

  function abrirPago(d: Deuda) {
    setDeudaPago(d);
    setMontoPago(String(d.monto_pendiente));
    setErrorPago(undefined);
    // Si la deuda la generó una obligación mensual, su categoría y cuenta ya están definidas.
    const concepto = d.descripcion.startsWith(PREFIJO_DEUDA_OBLIGACION)
      ? d.descripcion.slice(PREFIJO_DEUDA_OBLIGACION.length).trim()
      : null;
    const obligacion = concepto ? (obligaciones ?? []).find((o) => o.concepto === concepto) : undefined;
    setCategoriaPago(obligacion?.id_categoria ?? '');
    setCuentaPago(obligacion?.id_cuenta ?? cuentas?.[0]?.id_cuenta ?? '');
    // Descontar un adelanto del sueldo no mueve plata: no hay ingreso que registrar.
    setConMovimiento(!(d.tipo === 'me_deben' && d.id_trabajador));
  }

  async function confirmarPago() {
    if (!deudaPago) return;
    const monto = parseFloat(montoPago.replace(',', '.'));
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorPago('Ingresa un monto válido, mayor que cero.');
      return;
    }
    if (monto > deudaPago.monto_pendiente) {
      setErrorPago('No puede ser mayor que lo pendiente.');
      return;
    }
    if (conMovimiento && (!categoriaPago || !cuentaPago)) {
      setErrorPago('Elige categoría y cuenta, o desmarca "registrar también".');
      return;
    }
    setGuardandoPago(true);
    try {
      await registrarPagoDeuda(
        deudaPago.id_deuda,
        monto,
        conMovimiento ? { id_categoria: categoriaPago, id_cuenta: cuentaPago } : undefined,
      );
      setDeudaPago(null);
    } finally {
      setGuardandoPago(false);
    }
  }

  async function guardarNueva() {
    const monto = parseFloat(formNueva.monto_original.replace(',', '.'));
    if (!formNueva.persona.trim()) {
      setErrorNueva('Ingresa el nombre de la persona.');
      return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorNueva('Ingresa un monto válido, mayor que cero.');
      return;
    }
    setGuardandoNueva(true);
    try {
      const nueva: NuevaDeuda = {
        tipo: formNueva.tipo,
        persona: formNueva.persona.trim(),
        monto_original: monto,
        descripcion: formNueva.descripcion,
        fecha_vencimiento: formNueva.fecha_vencimiento,
        recordatorio: true,
        notas: '',
      };
      await crearDeuda(nueva);
      setModalNuevaAbierto(false);
      setFormNueva(formularioVacio());
    } finally {
      setGuardandoNueva(false);
    }
  }

  function abrirNuevaSolicitud() {
    setFormSolicitud(formularioSolicitudVacio());
    setErrorSolicitud(undefined);
    setModalSolicitudAbierto(true);
  }

  async function guardarSolicitud() {
    const monto = parseFloat(formSolicitud.monto.replace(',', '.'));
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorSolicitud('Ingresa un monto válido, mayor que cero.');
      return;
    }
    if (!formSolicitud.motivo.trim()) {
      setErrorSolicitud('Contá para qué es.');
      return;
    }
    if (!formSolicitud.id_categoria) {
      setErrorSolicitud('Elige una categoría.');
      return;
    }
    setGuardandoSolicitud(true);
    try {
      const nueva: NuevaSolicitud = {
        monto,
        motivo: formSolicitud.motivo.trim(),
        id_categoria: formSolicitud.id_categoria,
      };
      await crearSolicitud(nueva);
      setModalSolicitudAbierto(false);
    } catch (e) {
      setErrorSolicitud(mensajeError(e, 'No se pudo enviar la solicitud.'));
    } finally {
      setGuardandoSolicitud(false);
    }
  }

  function abrirResponder(solicitud: SolicitudDinero, aprobar: boolean) {
    setRespondiendo({ solicitud, aprobar });
    setMotivoRespuesta('');
    setErrorRespuesta(undefined);
  }

  async function confirmarRespuesta() {
    if (!respondiendo) return;
    setEnviandoRespuesta(true);
    try {
      await responderSolicitud(
        respondiendo.solicitud.id_solicitud,
        respondiendo.aprobar,
        motivoRespuesta.trim() || undefined,
      );
      setRespondiendo(null);
    } catch (e) {
      setErrorRespuesta(mensajeError(e, 'No se pudo registrar la respuesta.'));
    } finally {
      setEnviandoRespuesta(false);
    }
  }

  return (
    <>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <header className="deudas__cabecera">
        <h1 className="u-title-1">Deudas</h1>
      </header>

      <Prestamos sesion={sesion} />

      {listaOrdenada === undefined ? (
        <div className="deudas__esqueleto">
          <div className="u-skeleton" style={{ height: 92 }} aria-hidden="true" />
          <div className="u-skeleton" style={{ height: 92 }} aria-hidden="true" />
        </div>
      ) : listaOrdenada.length === 0 ? (
        <div className="tarjeta u-estado-vacio">
          <img className="u-estado-vacio__ilustracion" src={ilustracionDeudas} alt="" aria-hidden="true" />
          <p className="u-callout">No hay deudas registradas.</p>
          <p className="u-footnote">Toca "Nueva deuda" para llevar el control de lo que debes o te deben.</p>
        </div>
      ) : (
        <ul className="deudas__lista">
          {listaOrdenada.map((d) => {
            const dias = diasHasta(d.fecha_vencimiento, hoy);
            const urgente = d.estado === 'pendiente' && dias <= 3;
            const badge = etiquetaEstado(d, dias);
            const esAFavor = d.tipo === 'me_deben';

            return (
              <li key={d.id_deuda} className={`tarjeta deudas__tarjeta ${urgente ? 'deudas__tarjeta--urgente' : ''}`}>
                <div className="deudas__fila-superior">
                  <div>
                    <p className="u-headline">{d.persona}</p>
                    <p className="u-footnote">{esAFavor ? 'Te debe' : 'Le debes'}{d.descripcion ? ` · ${d.descripcion}` : ''}</p>
                  </div>
                  <span className={`deudas__badge ${badge.clase}`}>{badge.texto}</span>
                </div>

                <div className="deudas__fila-inferior">
                  <div>
                    <p className={`u-amount-md u-num ${esAFavor ? 'u-income' : 'u-expense'}`}>
                      {formatMoneda(d.monto_pendiente)}
                    </p>
                    <p className="u-footnote">Vence el {formatFechaLarga(d.fecha_vencimiento)}</p>
                  </div>
                  {d.estado !== 'pagada' && (
                    <Boton variante="secundario" tamano="chico" onClick={() => abrirPago(d)}>
                      Registrar pago
                    </Boton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Boton variante="primario" bloque onClick={() => setModalNuevaAbierto(true)}>
        + Nueva deuda
      </Boton>

      {/* Solicitudes de dinero (CONTRACT § 4-bis): segunda sección de esta misma pestaña, no un
          cuarto ítem de navegación — es plata que se mueve entre personas del mismo grupo. */}
      <section className="tarjeta deudas__solicitudes" aria-label="Solicitudes de dinero">
        <div className="deudas__solicitudes-cabecera">
          <h2 className="u-title-3">Solicitudes de dinero</h2>
          <Boton variante="secundario" tamano="chico" onClick={abrirNuevaSolicitud}>
            + Nueva solicitud
          </Boton>
        </div>

        {esPropietario && (
          <div className="deudas__solicitudes-grupo">
            <h3 className="u-subhead">Pendientes de responder</h3>
            {solicitudes === undefined ? (
              <div className="u-skeleton" style={{ height: 64 }} aria-hidden="true" />
            ) : pendientesDeResponder.length === 0 ? (
              <div className="u-estado-vacio deudas__solicitudes-vacio">
                <img className="u-estado-vacio__ilustracion deudas__solicitudes-ilustracion" src={ilustracionSolicitudes} alt="" aria-hidden="true" />
                <p className="u-footnote">No hay solicitudes esperando respuesta.</p>
              </div>
            ) : (
              <ul className="deudas__lista-solicitudes">
                {pendientesDeResponder.map((s) => (
                  <li key={s.id_solicitud} className="deudas__solicitud">
                    <div className="deudas__solicitud-info">
                      <p className="u-headline">{usuarioPorId.get(s.id_solicitante)?.nombre ?? 'Alguien del grupo'}</p>
                      <p className="u-footnote">{s.motivo || 'Sin motivo indicado'}</p>
                    </div>
                    <p className="u-amount-md u-num deudas__solicitud-monto">{formatMoneda(s.monto)}</p>
                    <div className="deudas__solicitud-acciones">
                      <Boton variante="secundario" tamano="chico" onClick={() => abrirResponder(s, false)}>
                        Rechazar
                      </Boton>
                      <Boton variante="primario" tamano="chico" onClick={() => abrirResponder(s, true)}>
                        Aprobar
                      </Boton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="deudas__solicitudes-grupo">
          <h3 className="u-subhead">Mis solicitudes</h3>
          {solicitudes === undefined ? (
            <div className="u-skeleton" style={{ height: 52 }} aria-hidden="true" />
          ) : misSolicitudes.length === 0 ? (
            <p className="u-footnote">Todavía no pediste plata en este espacio.</p>
          ) : (
            <ul className="deudas__lista-solicitudes">
              {misSolicitudes.map((s) => {
                const badge = ETIQUETA_ESTADO_SOLICITUD[s.estado];
                return (
                  <li key={s.id_solicitud} className="deudas__solicitud">
                    <div className="deudas__solicitud-info">
                      <p className="u-callout">{s.motivo || 'Sin motivo indicado'}</p>
                      <p className="u-footnote">{formatFechaLarga(s.fecha_solicitud.slice(0, 10))}</p>
                    </div>
                    <p className="u-amount u-num deudas__solicitud-monto">{formatMoneda(s.monto)}</p>
                    <span className={`deudas__badge ${badge.clase}`}>{badge.texto}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <Modal abierto={modalNuevaAbierto} onCerrar={() => setModalNuevaAbierto(false)} titulo="Nueva deuda">
        <div className="form-tipo" role="group" aria-label="Tipo de deuda">
          <button
            type="button"
            className={`form-chip-tipo ${formNueva.tipo === 'me_deben' ? 'form-chip-tipo--activo-ingreso' : ''}`}
            onClick={() => setFormNueva((f) => ({ ...f, tipo: 'me_deben' }))}
            aria-pressed={formNueva.tipo === 'me_deben'}
          >
            Me deben
          </button>
          <button
            type="button"
            className={`form-chip-tipo ${formNueva.tipo === 'debo' ? 'form-chip-tipo--activo-gasto' : ''}`}
            onClick={() => setFormNueva((f) => ({ ...f, tipo: 'debo' }))}
            aria-pressed={formNueva.tipo === 'debo'}
          >
            Debo
          </button>
        </div>

        <label className="form-campo">
          <span className="u-subhead">Persona</span>
          <input
            className="form-input"
            type="text"
            value={formNueva.persona}
            onChange={(e) => setFormNueva((f) => ({ ...f, persona: e.target.value }))}
            placeholder="Nombre"
            maxLength={80}
          />
        </label>

        <CampoMonto
          etiqueta="Monto"
          valor={formNueva.monto_original}
          onCambiar={(v) => { setFormNueva((f) => ({ ...f, monto_original: v })); setErrorNueva(undefined); }}
          error={errorNueva}
        />

        <label className="form-campo">
          <span className="u-subhead">Descripción (opcional)</span>
          <input
            className="form-input"
            type="text"
            value={formNueva.descripcion}
            onChange={(e) => setFormNueva((f) => ({ ...f, descripcion: e.target.value }))}
            maxLength={120}
          />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Vence el</span>
          <input
            className="form-input"
            type="date"
            value={formNueva.fecha_vencimiento}
            onChange={(e) => setFormNueva((f) => ({ ...f, fecha_vencimiento: e.target.value }))}
          />
        </label>

        <Boton variante="primario" bloque onClick={guardarNueva} disabled={guardandoNueva}>
          {guardandoNueva ? 'Guardando…' : 'Guardar deuda'}
        </Boton>
      </Modal>

      <Modal abierto={deudaPago !== null} onCerrar={() => setDeudaPago(null)} titulo="Registrar pago">
        {deudaPago && (
          <>
            <p className="u-callout">
              {deudaPago.persona} — pendiente <span className="u-num">{formatMoneda(deudaPago.monto_pendiente)}</span>
            </p>
            <CampoMonto valor={montoPago} onCambiar={(v) => { setMontoPago(v); setErrorPago(undefined); }} autoFocus error={errorPago} />
            <Boton variante="primario" bloque onClick={() => setMontoPago(String(deudaPago.monto_pendiente))}>
              Pago total
            </Boton>
            <label className="form-check">
              <input type="checkbox" checked={conMovimiento} onChange={(e) => setConMovimiento(e.target.checked)} />
              <span className="u-subhead">
                Registrar también como {deudaPago.tipo === 'debo' ? 'gasto' : 'ingreso'}
              </span>
            </label>
            {conMovimiento && (
              <>
                <label className="form-campo">
                  <span className="u-subhead">Categoría</span>
                  <select className="form-select" value={categoriaPago} onChange={(e) => setCategoriaPago(e.target.value)}>
                    <option value="" disabled>Elige una categoría</option>
                    {((deudaPago.tipo === 'debo' ? categoriasGasto : categoriasIngreso) ?? []).map((c) => (
                      <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
                    ))}
                  </select>
                </label>
                <label className="form-campo">
                  <span className="u-subhead">Cuenta</span>
                  <select className="form-select" value={cuentaPago} onChange={(e) => setCuentaPago(e.target.value)}>
                    <option value="" disabled>Elige una cuenta</option>
                    {(cuentas ?? []).map((c) => (
                      <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <Boton variante="primario" bloque onClick={confirmarPago} disabled={guardandoPago}>
              {guardandoPago ? 'Registrando…' : 'Confirmar pago'}
            </Boton>
          </>
        )}
      </Modal>

      <Modal abierto={modalSolicitudAbierto} onCerrar={() => setModalSolicitudAbierto(false)} titulo="Nueva solicitud de dinero">
        <CampoMonto
          etiqueta="Monto"
          valor={formSolicitud.monto}
          onCambiar={(v) => { setFormSolicitud((f) => ({ ...f, monto: v })); setErrorSolicitud(undefined); }}
          autoFocus
        />

        <label className="form-campo">
          <span className="u-subhead">Motivo</span>
          <input
            className="form-input"
            type="text"
            value={formSolicitud.motivo}
            onChange={(e) => setFormSolicitud((f) => ({ ...f, motivo: e.target.value }))}
            placeholder="Ej. Materiales para la obra"
            maxLength={160}
          />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Categoría</span>
          <select
            className="form-select"
            value={formSolicitud.id_categoria}
            onChange={(e) => setFormSolicitud((f) => ({ ...f, id_categoria: e.target.value }))}
          >
            <option value="" disabled>Elige una categoría</option>
            {(categoriasGasto ?? []).map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
            ))}
          </select>
        </label>

        {errorSolicitud && (
          <p className="u-footnote deudas__error" role="alert">{errorSolicitud}</p>
        )}

        <Boton variante="primario" bloque onClick={guardarSolicitud} disabled={guardandoSolicitud}>
          {guardandoSolicitud ? 'Enviando…' : 'Enviar solicitud'}
        </Boton>
      </Modal>

      <Modal
        abierto={respondiendo !== null}
        onCerrar={() => setRespondiendo(null)}
        titulo={respondiendo?.aprobar ? 'Aprobar solicitud' : 'Rechazar solicitud'}
      >
        {respondiendo && (
          <>
            <p className="u-callout">
              {usuarioPorId.get(respondiendo.solicitud.id_solicitante)?.nombre ?? 'Alguien del grupo'} pidió{' '}
              <span className="u-num">{formatMoneda(respondiendo.solicitud.monto)}</span> — {respondiendo.solicitud.motivo || 'sin motivo indicado'}
            </p>
            {respondiendo.aprobar && (
              <p className="u-footnote">Al aprobar se crea de una vez el gasto correspondiente.</p>
            )}
            <label className="form-campo">
              <span className="u-subhead">{respondiendo.aprobar ? 'Nota (opcional)' : 'Motivo del rechazo (opcional)'}</span>
              <input
                className="form-input"
                type="text"
                value={motivoRespuesta}
                onChange={(e) => setMotivoRespuesta(e.target.value)}
                maxLength={160}
              />
            </label>
            {errorRespuesta && (
              <p className="u-footnote deudas__error" role="alert">{errorRespuesta}</p>
            )}
            <Boton
              variante={respondiendo.aprobar ? 'primario' : 'peligro'}
              bloque
              onClick={confirmarRespuesta}
              disabled={enviandoRespuesta}
            >
              {enviandoRespuesta ? 'Enviando…' : respondiendo.aprobar ? 'Aprobar y crear el gasto' : 'Rechazar solicitud'}
            </Boton>
          </>
        )}
      </Modal>
    </>
  );
}
