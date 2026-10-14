import { useState } from 'react';
import type { TipoVinculo, Trabajador } from '../data/types';
import {
  actualizarTrabajador,
  crearTrabajador,
  darDeBajaTrabajador,
  useTrabajadores,
  type NuevoTrabajador,
} from '../data/api';
import {
  COLUMNAS_CSV_TRABAJADORES,
  interpretarCsvTrabajadores,
  interpretarMonto,
  type ResultadoImportacion,
} from '../data/importarTrabajadores';
import Modal, { Confirmacion } from '../components/Modal';
import Boton from '../components/Boton';
import { formatFechaCorta, formatMoneda } from '../design/format';
import ilustracionEquipo from '../assets/equipo.webp';
import '../components/Formulario.css';
import './Admin.css';

interface FormularioTrabajador {
  nombre: string;
  documento: string;
  tipo_vinculo: TipoVinculo;
  cargo: string;
  proyecto: string;
  sueldo_base: string;
  pension: string;
  fecha_ingreso: string;
  fecha_fin: string;
  notas: string;
}

function formularioVacio(): FormularioTrabajador {
  return {
    nombre: '',
    documento: '',
    tipo_vinculo: 'planilla',
    cargo: '',
    proyecto: '',
    sueldo_base: '',
    pension: '',
    fecha_ingreso: '',
    fecha_fin: '',
    notas: '',
  };
}

function formularioDesde(t: Trabajador): FormularioTrabajador {
  return {
    nombre: t.nombre,
    documento: t.documento,
    tipo_vinculo: t.tipo_vinculo,
    cargo: t.cargo,
    proyecto: t.proyecto,
    sueldo_base: t.sueldo_base ? String(t.sueldo_base) : '',
    pension: t.pension,
    fecha_ingreso: t.fecha_ingreso,
    fecha_fin: t.fecha_fin,
    notas: t.notas,
  };
}

function mensajeError(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto;
}

/**
 * Trabajadores del espacio activo (CONTRACT § 4-quater): a quién se le paga. Alta, corrección,
 * baja/reactivación, e importación por CSV que corrige por DNI en vez de duplicar.
 */
export default function AdminTrabajadores() {
  const trabajadores = useTrabajadores(true);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Trabajador | null>(null);
  const [form, setForm] = useState<FormularioTrabajador>(formularioVacio());
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  const [aDarDeBaja, setADarDeBaja] = useState<Trabajador | null>(null);

  const [importacion, setImportacion] = useState<ResultadoImportacion | null>(null);
  const [importando, setImportando] = useState(false);
  const [errorImportacion, setErrorImportacion] = useState<string | undefined>();

  function abrirNuevo() {
    setEditando(null);
    setForm(formularioVacio());
    setError(undefined);
    setModalAbierto(true);
  }

  function abrirEdicion(t: Trabajador) {
    setEditando(t);
    setForm(formularioDesde(t));
    setError(undefined);
    setModalAbierto(true);
  }

  function campo<K extends keyof FormularioTrabajador>(clave: K, valor: FormularioTrabajador[K]) {
    setForm((f) => ({ ...f, [clave]: valor }));
    setError(undefined);
  }

  async function guardar() {
    if (!form.nombre.trim()) {
      setError('Ingresa el nombre.');
      return;
    }
    const sueldo = interpretarMonto(form.sueldo_base);
    if (!Number.isFinite(sueldo) || sueldo < 0) {
      setError('El sueldo base no es un monto válido.');
      return;
    }
    if (form.fecha_ingreso && form.fecha_fin && form.fecha_fin < form.fecha_ingreso) {
      setError('El fin del contrato no puede ser anterior al ingreso.');
      return;
    }
    const datos: NuevoTrabajador = {
      nombre: form.nombre.trim(),
      documento: form.documento.replace(/\s/g, ''),
      tipo_vinculo: form.tipo_vinculo,
      cargo: form.cargo.trim(),
      proyecto: form.proyecto.trim(),
      sueldo_base: sueldo,
      pension: form.pension.trim(),
      fecha_ingreso: form.fecha_ingreso,
      fecha_fin: form.fecha_fin,
      notas: form.notas.trim(),
    };
    const duplicado = datos.documento
      ? trabajadores?.find((t) => t.documento === datos.documento && t.id_trabajador !== editando?.id_trabajador)
      : undefined;
    if (duplicado) {
      setError(`Ese documento ya es de ${duplicado.nombre}.`);
      return;
    }

    setGuardando(true);
    try {
      if (editando) await actualizarTrabajador(editando.id_trabajador, datos);
      else await crearTrabajador(datos);
      setModalAbierto(false);
    } catch (e) {
      setError(mensajeError(e, 'No se pudo guardar.'));
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarBaja() {
    if (!aDarDeBaja) return;
    try {
      await darDeBajaTrabajador(aDarDeBaja.id_trabajador);
      setADarDeBaja(null);
    } catch (e) {
      window.alert(mensajeError(e, 'No se pudo dar de baja.'));
    }
  }

  async function reactivar(t: Trabajador) {
    try {
      await actualizarTrabajador(t.id_trabajador, { activo: true });
    } catch (e) {
      window.alert(mensajeError(e, 'No se pudo reactivar.'));
    }
  }

  async function leerArchivo(archivo: File | undefined) {
    if (!archivo) return;
    setErrorImportacion(undefined);
    setImportacion(interpretarCsvTrabajadores(await archivo.text(), trabajadores ?? []));
  }

  async function aplicarImportacion() {
    if (!importacion) return;
    setImportando(true);
    let hechas = 0;
    try {
      for (const fila of importacion.filas) {
        if (fila.id_existente) await actualizarTrabajador(fila.id_existente, fila.datos);
        else await crearTrabajador(fila.datos);
        hechas++;
      }
      setImportacion(null);
    } catch (e) {
      // Las filas ya aplicadas quedan; volver a importar el mismo archivo las corrige sin duplicar.
      setErrorImportacion(`Se aplicaron ${hechas} de ${importacion.filas.length}. ${mensajeError(e, '')}`);
    } finally {
      setImportando(false);
    }
  }

  const nuevos = importacion?.filas.filter((f) => !f.id_existente).length ?? 0;
  const aCorregir = (importacion?.filas.length ?? 0) - nuevos;

  return (
    <section className="tarjeta admin__obligaciones" aria-label="Trabajadores">
      <div className="admin__obligaciones-cabecera">
        <h2 className="u-title-3">Trabajadores</h2>
        <Boton variante="secundario" tamano="chico" onClick={abrirNuevo}>
          + Nuevo
        </Boton>
      </div>
      <p className="u-footnote">A quién se le paga planilla u honorarios. No necesitan usar la app.</p>

      {trabajadores === undefined ? (
        <div className="u-skeleton" style={{ height: 64 }} aria-hidden="true" />
      ) : trabajadores.length === 0 ? (
        <div className="u-estado-vacio">
          <img className="u-estado-vacio__ilustracion" src={ilustracionEquipo} alt="" aria-hidden="true" />
          <p className="u-callout">Sin trabajadores en este espacio.</p>
          <p className="u-footnote">Agrégalos uno por uno o impórtalos desde un CSV.</p>
        </div>
      ) : (
        <ul className="admin__lista-obligaciones">
          {trabajadores.map((t) => (
            <li key={t.id_trabajador} className={`admin__obligacion ${!t.activo ? 'admin__obligacion--inactiva' : ''}`}>
              <div className="admin__obligacion-info">
                <p className="u-callout">{t.nombre}</p>
                <p className="u-footnote">
                  {[t.cargo, t.proyecto, t.tipo_vinculo === 'honorarios' ? 'Honorarios' : 'Planilla', t.documento && `DNI ${t.documento}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="admin__badges">
                  {!t.activo && <span className="admin__badge admin__badge--inactivo">De baja</span>}
                  {t.fecha_fin && (
                    <span className="admin__badge admin__badge--pendiente">Hasta {formatFechaCorta(t.fecha_fin)}</span>
                  )}
                  {!t.pension && t.tipo_vinculo === 'planilla' && (
                    <span className="admin__badge admin__badge--inactivo">Sin ONP/AFP</span>
                  )}
                </div>
              </div>
              <div className="admin__obligacion-acciones">
                <p className="u-amount u-num">{t.sueldo_base ? formatMoneda(t.sueldo_base) : '—'}</p>
                <div className="admin__obligacion-botones">
                  <Boton variante="secundario" tamano="chico" onClick={() => abrirEdicion(t)}>
                    Editar
                  </Boton>
                  {t.activo ? (
                    <Boton variante="peligro" tamano="chico" onClick={() => setADarDeBaja(t)}>
                      Dar de baja
                    </Boton>
                  ) : (
                    <Boton variante="secundario" tamano="chico" onClick={() => reactivar(t)}>
                      Reactivar
                    </Boton>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <label className="admin__importar">
        <span className="u-subhead">Importar o corregir desde CSV</span>
        <span className="u-caption">
          Columnas: {COLUMNAS_CSV_TRABAJADORES.join(', ')}. Si el DNI ya existe, se corrige ese trabajador.
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            void leerArchivo(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>

      <Modal abierto={modalAbierto} onCerrar={() => setModalAbierto(false)} titulo={editando ? 'Corregir trabajador' : 'Nuevo trabajador'}>
        <label className="form-campo">
          <span className="u-subhead">Nombre completo</span>
          <input className="form-input" value={form.nombre} onChange={(e) => campo('nombre', e.target.value)} maxLength={120} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">DNI / documento</span>
          <input className="form-input u-num" inputMode="numeric" value={form.documento} onChange={(e) => campo('documento', e.target.value)} maxLength={20} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">Vínculo</span>
          <select className="form-select" value={form.tipo_vinculo} onChange={(e) => campo('tipo_vinculo', e.target.value as TipoVinculo)}>
            <option value="planilla">Planilla</option>
            <option value="honorarios">Honorarios / locación</option>
          </select>
        </label>
        <label className="form-campo">
          <span className="u-subhead">Cargo</span>
          <input className="form-input" value={form.cargo} onChange={(e) => campo('cargo', e.target.value)} maxLength={80} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">Proyecto / contrato</span>
          <input className="form-input" value={form.proyecto} onChange={(e) => campo('proyecto', e.target.value)} placeholder="Ej. CP-026" maxLength={80} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">{form.tipo_vinculo === 'honorarios' ? 'Honorario mensual (referencial)' : 'Sueldo base'}</span>
          <input
            className="form-input u-num"
            inputMode="decimal"
            value={form.sueldo_base}
            onChange={(e) => campo('sueldo_base', e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder="0.00"
          />
        </label>
        {form.tipo_vinculo === 'planilla' && (
          <label className="form-campo">
            <span className="u-subhead">Régimen pensionario</span>
            <input className="form-input" value={form.pension} onChange={(e) => campo('pension', e.target.value)} placeholder="ONP, AFP Integra…" list="pensiones" />
            <datalist id="pensiones">
              <option value="ONP" />
              <option value="AFP Integra" />
              <option value="AFP Prima" />
              <option value="AFP Profuturo" />
              <option value="AFP Habitat" />
            </datalist>
          </label>
        )}
        <label className="form-campo">
          <span className="u-subhead">Ingreso</span>
          <input className="form-input" type="date" value={form.fecha_ingreso} onChange={(e) => campo('fecha_ingreso', e.target.value)} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">Fin del contrato (vacío = indefinido)</span>
          <input className="form-input" type="date" value={form.fecha_fin} onChange={(e) => campo('fecha_fin', e.target.value)} />
        </label>
        <label className="form-campo">
          <span className="u-subhead">Notas</span>
          <input className="form-input" value={form.notas} onChange={(e) => campo('notas', e.target.value)} maxLength={300} />
        </label>
        {error && <p className="u-footnote admin__error" role="alert">{error}</p>}
        <Boton variante="primario" bloque onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </Modal>

      <Modal abierto={importacion !== null} onCerrar={() => setImportacion(null)} titulo="Importar trabajadores">
        {importacion && (
          <>
            <p className="u-callout">
              {nuevos} nuevo{nuevos === 1 ? '' : 's'} · {aCorregir} a corregir
              {importacion.errores.length > 0 && ` · ${importacion.errores.length} con error`}
            </p>
            <ul className="admin__importar-lista">
              {importacion.filas.map((f) => (
                <li key={f.linea} className="u-footnote">
                  {f.id_existente ? '✏️' : '➕'} {f.datos.nombre}
                  {f.datos.sueldo_base ? ` — ${formatMoneda(f.datos.sueldo_base)}` : ''}
                </li>
              ))}
              {importacion.errores.map((e) => (
                <li key={`e${e.linea}`} className="u-footnote admin__error">
                  Línea {e.linea}: {e.mensaje}
                </li>
              ))}
            </ul>
            {errorImportacion && <p className="u-footnote admin__error" role="alert">{errorImportacion}</p>}
            <Boton variante="primario" bloque onClick={aplicarImportacion} disabled={importando || importacion.filas.length === 0}>
              {importando ? 'Importando…' : `Aplicar ${importacion.filas.length} fila${importacion.filas.length === 1 ? '' : 's'}`}
            </Boton>
          </>
        )}
      </Modal>

      <Confirmacion
        abierto={aDarDeBaja !== null}
        titulo="Dar de baja"
        mensaje={`${aDarDeBaja?.nombre ?? ''} deja de aparecer al registrar pagos. Su historial queda, y se puede reactivar.`}
        textoConfirmar="Dar de baja"
        peligro
        onConfirmar={confirmarBaja}
        onCancelar={() => setADarDeBaja(null)}
      />
    </section>
  );
}
