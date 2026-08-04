import { useMemo, useState } from 'react';
import type { ObligacionMensual, Sesion } from '../data/types';
import {
  actualizarObligacion,
  crearObligacion,
  crearUsuario,
  desactivarUsuario,
  eliminarObligacion,
  useCategorias,
  useCuentas,
  useObligaciones,
  useUsuarios,
  type NuevaObligacion,
} from '../data/api';
import Modal, { Confirmacion } from '../components/Modal';
import Boton from '../components/Boton';
import SelectorEspacio from '../components/SelectorEspacio';
import { formatMoneda, iniciales } from '../design/format';
import '../components/Formulario.css';
import './Admin.css';

interface AdminProps {
  sesion: Sesion;
}

interface FormularioObligacion {
  concepto: string;
  id_categoria: string;
  id_cuenta: string;
  monto_estimado: string;
  dia_vencimiento: string;
  notas: string;
}

function formularioObligacionVacio(): FormularioObligacion {
  return { concepto: '', id_categoria: '', id_cuenta: '', monto_estimado: '', dia_vencimiento: '1', notas: '' };
}

function formularioObligacionDesde(o: ObligacionMensual): FormularioObligacion {
  return {
    concepto: o.concepto,
    id_categoria: o.id_categoria,
    id_cuenta: o.id_cuenta,
    monto_estimado: String(o.monto_estimado),
    dia_vencimiento: String(o.dia_vencimiento),
    notas: o.notas,
  };
}

/** Mensaje de error de la capa de datos (ej. "requiere conexión") no siempre es un Error real. */
function mensajeError(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto;
}

export default function Admin({ sesion }: AdminProps) {
  const usuarios = useUsuarios();

  const [modalAbierto, setModalAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  const [aDesactivar, setADesactivar] = useState<{ id: string; nombre: string } | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  // ---- Obligaciones mensuales (CONTRACT § 4-ter): solo el propietario, por espacio. ----
  const obligaciones = useObligaciones();
  const categoriasGasto = useCategorias('gasto');
  const cuentas = useCuentas();
  const categoriaPorId = useMemo(() => new Map((categoriasGasto ?? []).map((c) => [c.id_categoria, c])), [categoriasGasto]);
  const cuentaPorId = useMemo(() => new Map((cuentas ?? []).map((c) => [c.id_cuenta, c])), [cuentas]);
  const periodoActual = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const [modalObligacionAbierto, setModalObligacionAbierto] = useState(false);
  const [editandoObligacion, setEditandoObligacion] = useState<ObligacionMensual | null>(null);
  const [formObligacion, setFormObligacion] = useState<FormularioObligacion>(formularioObligacionVacio());
  const [errorObligacion, setErrorObligacion] = useState<string | undefined>();
  const [guardandoObligacion, setGuardandoObligacion] = useState(false);

  const [aDarDeBaja, setADarDeBaja] = useState<ObligacionMensual | null>(null);
  const [dandoDeBaja, setDandoDeBaja] = useState(false);

  async function guardarUsuario() {
    if (!nombre.trim()) {
      setError('Ingresa el nombre.');
      return;
    }
    const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!emailValido) {
      setError('Ingresa un email válido.');
      return;
    }
    setGuardando(true);
    try {
      await crearUsuario({ nombre: nombre.trim(), email: email.trim() });
      setModalAbierto(false);
      setNombre('');
      setEmail('');
      setError(undefined);
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarDesactivacion() {
    if (!aDesactivar) return;
    setDesactivando(true);
    try {
      await desactivarUsuario(aDesactivar.id);
      setADesactivar(null);
    } finally {
      setDesactivando(false);
    }
  }

  function abrirNuevaObligacion() {
    setEditandoObligacion(null);
    setFormObligacion(formularioObligacionVacio());
    setErrorObligacion(undefined);
    setModalObligacionAbierto(true);
  }

  function abrirEdicionObligacion(o: ObligacionMensual) {
    setEditandoObligacion(o);
    setFormObligacion(formularioObligacionDesde(o));
    setErrorObligacion(undefined);
    setModalObligacionAbierto(true);
  }

  async function guardarObligacion() {
    const monto = parseFloat(formObligacion.monto_estimado.replace(',', '.'));
    const dia = parseInt(formObligacion.dia_vencimiento, 10);
    if (!formObligacion.concepto.trim()) {
      setErrorObligacion('Ingresa el concepto.');
      return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorObligacion('Ingresa un monto estimado válido, mayor que cero.');
      return;
    }
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      setErrorObligacion('El día de vencimiento va del 1 al 31.');
      return;
    }
    if (!formObligacion.id_categoria || !formObligacion.id_cuenta) {
      setErrorObligacion('Elige categoría y cuenta.');
      return;
    }
    setGuardandoObligacion(true);
    try {
      if (editandoObligacion) {
        await actualizarObligacion(editandoObligacion.id_obligacion, {
          concepto: formObligacion.concepto.trim(),
          id_categoria: formObligacion.id_categoria,
          id_cuenta: formObligacion.id_cuenta,
          monto_estimado: monto,
          dia_vencimiento: dia,
          notas: formObligacion.notas,
        });
      } else {
        const nueva: NuevaObligacion = {
          concepto: formObligacion.concepto.trim(),
          id_categoria: formObligacion.id_categoria,
          id_cuenta: formObligacion.id_cuenta,
          monto_estimado: monto,
          dia_vencimiento: dia,
          notas: formObligacion.notas,
        };
        await crearObligacion(nueva);
      }
      setModalObligacionAbierto(false);
    } catch (e) {
      setErrorObligacion(mensajeError(e, 'No se pudo guardar la obligación.'));
    } finally {
      setGuardandoObligacion(false);
    }
  }

  async function confirmarBajaObligacion() {
    if (!aDarDeBaja) return;
    setDandoDeBaja(true);
    try {
      await eliminarObligacion(aDarDeBaja.id_obligacion);
      setADarDeBaja(null);
    } catch (e) {
      // Sin un lugar propio donde mostrarlo dentro de la confirmación, se resigna a un alert
      // simple: es el único caso de error de esta acción y no vale la pena un estado extra.
      window.alert(mensajeError(e, 'No se pudo dar de baja la obligación.'));
    } finally {
      setDandoDeBaja(false);
    }
  }

  return (
    <>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <header className="admin__cabecera">
        <h1 className="u-title-1">Administración</h1>
        <p className="u-subhead">Alta y baja de personas, y las obligaciones mensuales del espacio elegido arriba.</p>
      </header>

      {usuarios === undefined ? (
        <div className="admin__esqueleto">
          <div className="u-skeleton" style={{ height: 68 }} aria-hidden="true" />
          <div className="u-skeleton" style={{ height: 68 }} aria-hidden="true" />
        </div>
      ) : usuarios.length === 0 ? (
        <div className="tarjeta u-estado-vacio">
          <span className="u-estado-vacio__icono">👥</span>
          <p className="u-callout">Todavía no hay nadie dado de alta.</p>
        </div>
      ) : (
        <ul className="admin__lista">
          {usuarios.map((u) => {
            const esUnoMismo = u.id_usuario === sesion.usuario.id_usuario;
            return (
              <li key={u.id_usuario} className="tarjeta admin__fila">
                <span className="admin__avatar" aria-hidden="true">{iniciales(u.nombre)}</span>
                <div className="admin__info">
                  <p className="u-callout">
                    {u.nombre} {u.rol_global === 'propietario' && <span className="admin__etiqueta-rol">Propietario</span>}
                  </p>
                  <p className="u-footnote">{u.email}</p>
                  <div className="admin__badges">
                    <span className={`admin__badge ${u.activo ? 'admin__badge--activo' : 'admin__badge--inactivo'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                    <span className={`admin__badge ${u.telegram_chat_id ? 'admin__badge--telegram' : 'admin__badge--inactivo'}`}>
                      {u.telegram_chat_id ? 'Telegram vinculado' : 'Sin Telegram'}
                    </span>
                  </div>
                </div>
                {u.activo && !esUnoMismo && (
                  <Boton
                    variante="peligro"
                    tamano="chico"
                    onClick={() => setADesactivar({ id: u.id_usuario, nombre: u.nombre })}
                  >
                    Dar de baja
                  </Boton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Boton variante="primario" bloque onClick={() => setModalAbierto(true)}>
        + Agregar usuario
      </Boton>

      {/* Obligaciones mensuales (CONTRACT § 4-ter): planilla, EsSalud, CTS, alquiler, seguros...
          se definen una vez acá y el sistema las materializa cada mes como deuda. */}
      <section className="tarjeta admin__obligaciones" aria-label="Obligaciones mensuales">
        <div className="admin__obligaciones-cabecera">
          <h2 className="u-title-3">Obligaciones mensuales</h2>
          <Boton variante="secundario" tamano="chico" onClick={abrirNuevaObligacion}>
            + Nueva obligación
          </Boton>
        </div>

        {obligaciones === undefined ? (
          <div className="admin__esqueleto">
            <div className="u-skeleton" style={{ height: 64 }} aria-hidden="true" />
            <div className="u-skeleton" style={{ height: 64 }} aria-hidden="true" />
          </div>
        ) : obligaciones.length === 0 ? (
          <div className="u-estado-vacio">
            <span className="u-estado-vacio__icono">📅</span>
            <p className="u-callout">Sin obligaciones definidas en este espacio.</p>
          </div>
        ) : (
          <ul className="admin__lista-obligaciones">
            {obligaciones.map((o) => {
              const categoria = categoriaPorId.get(o.id_categoria);
              const cuenta = cuentaPorId.get(o.id_cuenta);
              const generadaEsteMes = o.ultimo_periodo_generado === periodoActual;
              return (
                <li key={o.id_obligacion} className={`admin__obligacion ${!o.activo ? 'admin__obligacion--inactiva' : ''}`}>
                  <div className="admin__obligacion-info">
                    <p className="u-callout">
                      {categoria?.icono ?? '📅'} {o.concepto}
                    </p>
                    <p className="u-footnote">
                      Día {o.dia_vencimiento} · {categoria?.nombre ?? 'Sin categoría'}{cuenta ? ` · ${cuenta.nombre}` : ''}
                    </p>
                    <div className="admin__badges">
                      {!o.activo ? (
                        <span className="admin__badge admin__badge--inactivo">Inactiva</span>
                      ) : (
                        <span className={`admin__badge ${generadaEsteMes ? 'admin__badge--activo' : 'admin__badge--pendiente'}`}>
                          {generadaEsteMes ? 'Generada este mes' : 'Pendiente de generar'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="admin__obligacion-acciones">
                    <p className="u-amount u-num">{formatMoneda(o.monto_estimado)}</p>
                    {o.activo && (
                      <div className="admin__obligacion-botones">
                        <Boton variante="secundario" tamano="chico" onClick={() => abrirEdicionObligacion(o)}>
                          Editar
                        </Boton>
                        <Boton variante="peligro" tamano="chico" onClick={() => setADarDeBaja(o)}>
                          Dar de baja
                        </Boton>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Modal abierto={modalAbierto} onCerrar={() => setModalAbierto(false)} titulo="Agregar usuario">
        <label className="form-campo">
          <span className="u-subhead">Nombre</span>
          <input
            className="form-input"
            type="text"
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setError(undefined); }}
            placeholder="Nombre completo"
            maxLength={80}
          />
        </label>
        <label className="form-campo">
          <span className="u-subhead">Email de Google</span>
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(undefined); }}
            placeholder="persona@gmail.com"
          />
        </label>
        {error && <p className="u-footnote admin__error" role="alert">{error}</p>}
        <Boton variante="primario" bloque onClick={guardarUsuario} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </Modal>

      <Confirmacion
        abierto={aDesactivar !== null}
        titulo="Dar de baja"
        mensaje={`${aDesactivar?.nombre ?? ''} ya no va a poder entrar a Chanchito. Se puede revertir después.`}
        textoConfirmar={desactivando ? 'Dando de baja…' : 'Dar de baja'}
        peligro
        onConfirmar={confirmarDesactivacion}
        onCancelar={() => setADesactivar(null)}
      />

      <Modal
        abierto={modalObligacionAbierto}
        onCerrar={() => setModalObligacionAbierto(false)}
        titulo={editandoObligacion ? 'Editar obligación' : 'Nueva obligación'}
      >
        <label className="form-campo">
          <span className="u-subhead">Concepto</span>
          <input
            className="form-input"
            type="text"
            value={formObligacion.concepto}
            onChange={(e) => setFormObligacion((f) => ({ ...f, concepto: e.target.value }))}
            placeholder="Ej. Alquiler de oficina"
            maxLength={120}
          />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Categoría</span>
          <select
            className="form-select"
            value={formObligacion.id_categoria}
            onChange={(e) => setFormObligacion((f) => ({ ...f, id_categoria: e.target.value }))}
          >
            <option value="" disabled>Elige una categoría</option>
            {(categoriasGasto ?? []).map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
            ))}
          </select>
        </label>

        <label className="form-campo">
          <span className="u-subhead">Cuenta</span>
          <select
            className="form-select"
            value={formObligacion.id_cuenta}
            onChange={(e) => setFormObligacion((f) => ({ ...f, id_cuenta: e.target.value }))}
          >
            <option value="" disabled>Elige una cuenta</option>
            {(cuentas ?? []).map((c) => (
              <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
            ))}
          </select>
        </label>

        <label className="form-campo">
          <span className="u-subhead">Monto estimado</span>
          <input
            className="form-input u-num"
            type="text"
            inputMode="decimal"
            value={formObligacion.monto_estimado}
            onChange={(e) => setFormObligacion((f) => ({ ...f, monto_estimado: e.target.value.replace(/[^0-9.,]/g, '') }))}
            placeholder="0.00"
          />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Día de vencimiento</span>
          <input
            className="form-input u-num"
            type="number"
            min={1}
            max={31}
            value={formObligacion.dia_vencimiento}
            onChange={(e) => setFormObligacion((f) => ({ ...f, dia_vencimiento: e.target.value }))}
          />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Notas (opcional)</span>
          <input
            className="form-input"
            type="text"
            value={formObligacion.notas}
            onChange={(e) => setFormObligacion((f) => ({ ...f, notas: e.target.value }))}
            maxLength={160}
          />
        </label>

        {errorObligacion && <p className="u-footnote admin__error" role="alert">{errorObligacion}</p>}

        <Boton variante="primario" bloque onClick={guardarObligacion} disabled={guardandoObligacion}>
          {guardandoObligacion ? 'Guardando…' : 'Guardar obligación'}
        </Boton>
      </Modal>

      <Confirmacion
        abierto={aDarDeBaja !== null}
        titulo="Dar de baja"
        mensaje={`"${aDarDeBaja?.concepto ?? ''}" deja de generarse cada mes. Las deudas ya generadas no se tocan.`}
        textoConfirmar={dandoDeBaja ? 'Dando de baja…' : 'Dar de baja'}
        peligro
        onConfirmar={confirmarBajaObligacion}
        onCancelar={() => setADarDeBaja(null)}
      />
    </>
  );
}
