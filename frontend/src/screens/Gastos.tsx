import { useMemo, useState } from 'react';
import type { Categoria, Sesion, Transaccion, TipoMovimiento } from '../data/types';
import {
  crearTransaccion,
  editarTransaccion,
  eliminarTransaccion,
  useCategorias,
  useCuentas,
  useEstadoSync,
  useTransacciones,
  useUsuarios,
  type FiltroGastos,
  type NuevaTransaccion,
} from '../data/api';
import FilaTransaccion from '../components/FilaTransaccion';
import Modal, { Confirmacion } from '../components/Modal';
import Boton from '../components/Boton';
import CampoMonto from '../components/CampoMonto';
import SelectorEspacio from '../components/SelectorEspacio';
import { nombreMesCorto } from '../design/format';
import '../components/Formulario.css';
import './Gastos.css';

interface GastosProps {
  sesion: Sesion;
}

const SIN_FILTRO = 'todos';

/** Mismo mapeo de etiquetas que Resumen.tsx (CONTRACT § 6-bis). Categoria.grupo es '' en
 * Familia, así que ahí nunca se ve ningún <optgroup>. */
const ETIQUETA_GRUPO: Record<string, string> = {
  operativos: 'Operativos',
  personal: 'Personal',
  activos: 'Activos fijos',
  impuestos: 'Impuestos',
  ingresos: 'Ingresos',
};

/** Agrupa categorías por `grupo` conservando el orden de aparición de cada grupo; las de
 * grupo '' quedan sueltas (sin <optgroup>) tanto en Familia como en la categoría suelta de Telcom. */
function agruparCategorias(categorias: Categoria[]): { sueltas: Categoria[]; grupos: Array<{ clave: string; categorias: Categoria[] }> } {
  const sueltas: Categoria[] = [];
  const porGrupo = new Map<string, Categoria[]>();
  const ordenGrupos: string[] = [];
  for (const c of categorias) {
    if (!c.grupo) {
      sueltas.push(c);
      continue;
    }
    if (!porGrupo.has(c.grupo)) {
      porGrupo.set(c.grupo, []);
      ordenGrupos.push(c.grupo);
    }
    porGrupo.get(c.grupo)!.push(c);
  }
  return { sueltas, grupos: ordenGrupos.map((clave) => ({ clave, categorias: porGrupo.get(clave)! })) };
}

interface FormularioTransaccion {
  tipo: TipoMovimiento;
  monto: string;
  id_categoria: string;
  id_cuenta: string;
  descripcion: string;
  fecha: string;
}

function formularioVacio(): FormularioTransaccion {
  const hoy = new Date();
  return {
    tipo: 'gasto',
    monto: '',
    id_categoria: '',
    id_cuenta: '',
    descripcion: '',
    fecha: hoy.toISOString().slice(0, 10),
  };
}

function formularioDesde(t: Transaccion): FormularioTransaccion {
  return {
    tipo: t.tipo,
    monto: String(t.monto),
    id_categoria: t.id_categoria,
    id_cuenta: t.id_cuenta,
    descripcion: t.descripcion,
    fecha: t.fecha,
  };
}

export default function Gastos({ sesion }: GastosProps) {
  const hoy = useMemo(() => new Date(), []);
  const [mesFiltro, setMesFiltro] = useState(hoy.getMonth() + 1);
  const [anioFiltro] = useState(hoy.getFullYear());
  const [categoriaFiltro, setCategoriaFiltro] = useState(SIN_FILTRO);
  const [usuarioFiltro, setUsuarioFiltro] = useState(SIN_FILTRO);
  const [tipoFiltro, setTipoFiltro] = useState<TipoMovimiento | typeof SIN_FILTRO>(SIN_FILTRO);

  const filtro: FiltroGastos = useMemo(
    () => ({
      mes: mesFiltro,
      anio: anioFiltro,
      ...(categoriaFiltro !== SIN_FILTRO ? { id_categoria: categoriaFiltro } : {}),
      ...(usuarioFiltro !== SIN_FILTRO ? { id_usuario: usuarioFiltro } : {}),
      ...(tipoFiltro !== SIN_FILTRO ? { tipo: tipoFiltro } : {}),
    }),
    [mesFiltro, anioFiltro, categoriaFiltro, usuarioFiltro, tipoFiltro]
  );

  const transacciones = useTransacciones(filtro);
  const categorias = useCategorias();
  const cuentas = useCuentas();
  const usuarios = useUsuarios();
  const estadoSync = useEstadoSync();

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<Transaccion | null>(null);
  const [form, setForm] = useState<FormularioTransaccion>(formularioVacio());
  const [errorMonto, setErrorMonto] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  const [aBorrar, setABorrar] = useState<Transaccion | null>(null);

  const categoriaPorId = useMemo(() => new Map((categorias ?? []).map((c) => [c.id_categoria, c])), [categorias]);
  const usuarioPorId = useMemo(() => new Map((usuarios ?? []).map((u) => [u.id_usuario, u])), [usuarios]);
  const categoriasDelTipo = (categorias ?? []).filter((c: Categoria) => c.tipo === form.tipo);
  const categoriasAgrupadas = useMemo(() => agruparCategorias(categoriasDelTipo), [categoriasDelTipo]);

  const listaOrdenada = useMemo(() => {
    if (!transacciones) return undefined;
    return [...transacciones].sort((a, b) => (a.fecha + a.hora < b.fecha + b.hora ? 1 : -1));
  }, [transacciones]);

  function abrirNuevo() {
    setEditando(null);
    setForm(formularioVacio());
    setErrorMonto(undefined);
    setModalAbierto(true);
  }

  function abrirEdicion(t: Transaccion) {
    setEditando(t);
    setForm(formularioDesde(t));
    setErrorMonto(undefined);
    setModalAbierto(true);
  }

  async function guardar() {
    const monto = parseFloat(form.monto.replace(',', '.'));
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrorMonto('Ingresa un monto válido, mayor que cero.');
      return;
    }
    if (!form.id_categoria || !form.id_cuenta) {
      setErrorMonto('Elige categoría y cuenta.');
      return;
    }

    setGuardando(true);
    try {
      if (editando) {
        await editarTransaccion(editando.id_transaccion, {
          tipo: form.tipo,
          monto,
          id_categoria: form.id_categoria,
          id_cuenta: form.id_cuenta,
          descripcion: form.descripcion,
          fecha: form.fecha,
        });
      } else {
        const nueva: NuevaTransaccion = {
          id_usuario: sesion.usuario.id_usuario,
          id_cuenta: form.id_cuenta,
          id_categoria: form.id_categoria,
          tipo: form.tipo,
          monto,
          descripcion: form.descripcion,
          fecha: form.fecha,
          hora: new Date().toTimeString().slice(0, 8),
          ubicacion: '',
          notas: '',
        };
        await crearTransaccion(nueva);
      }
      setModalAbierto(false);
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarBorrado() {
    if (!aBorrar) return;
    await eliminarTransaccion(aBorrar.id_transaccion);
    setABorrar(null);
  }

  return (
    <>
      <div className="selector-espacio-wrap">
        <SelectorEspacio />
      </div>

      <header className="gastos__cabecera">
        <h1 className="u-title-1">Gastos</h1>
        {!estadoSync.enLinea ? (
          <p className="u-footnote gastos__estado-sync">
            <span className="gastos__punto-sync gastos__punto-sync--offline" /> Sin conexión — se sincroniza al volver
          </p>
        ) : estadoSync.pendientes > 0 ? (
          <p className="u-footnote gastos__estado-sync">
            <span className="gastos__punto-sync" /> {estadoSync.pendientes} pendiente{estadoSync.pendientes === 1 ? '' : 's'} de sincronizar
          </p>
        ) : null}
      </header>

      <div className="gastos__filtros" role="group" aria-label="Filtros">
        <select
          className="gastos__filtro"
          value={mesFiltro}
          onChange={(e) => setMesFiltro(Number(e.target.value))}
          aria-label="Filtrar por mes"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{nombreMesCorto(m)}</option>
          ))}
        </select>
        <select
          className="gastos__filtro"
          value={tipoFiltro}
          onChange={(e) => setTipoFiltro(e.target.value as TipoMovimiento | typeof SIN_FILTRO)}
          aria-label="Filtrar por tipo"
        >
          <option value={SIN_FILTRO}>Todo tipo</option>
          <option value="gasto">Gastos</option>
          <option value="ingreso">Ingresos</option>
        </select>
        <select
          className="gastos__filtro"
          value={categoriaFiltro}
          onChange={(e) => setCategoriaFiltro(e.target.value)}
          aria-label="Filtrar por categoría"
        >
          <option value={SIN_FILTRO}>Toda categoría</option>
          {(categorias ?? []).map((c) => (
            <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
          ))}
        </select>
        <select
          className="gastos__filtro"
          value={usuarioFiltro}
          onChange={(e) => setUsuarioFiltro(e.target.value)}
          aria-label="Filtrar por usuario"
        >
          <option value={SIN_FILTRO}>Todos</option>
          {(usuarios ?? []).map((u) => (
            <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>
          ))}
        </select>
      </div>

      <section className="tarjeta gastos__lista-contenedor" aria-label="Lista de transacciones">
        {listaOrdenada === undefined ? (
          <div className="gastos__esqueleto">
            <div className="u-skeleton" style={{ height: 56 }} aria-hidden="true" />
            <div className="u-skeleton" style={{ height: 56 }} aria-hidden="true" />
            <div className="u-skeleton" style={{ height: 56 }} aria-hidden="true" />
          </div>
        ) : listaOrdenada.length === 0 ? (
          <div className="u-estado-vacio">
            <span className="u-estado-vacio__icono">🧾</span>
            <p className="u-callout">No hay movimientos con estos filtros.</p>
            <p className="u-footnote">Toca el botón + para registrar el primero.</p>
          </div>
        ) : (
          <ul className="gastos__lista">
            {listaOrdenada.map((t) => (
              <FilaTransaccion
                key={t.id_transaccion}
                transaccion={t}
                categoria={categoriaPorId.get(t.id_categoria)}
                usuario={usuarioPorId.get(t.id_usuario)}
                onSeleccionar={() => abrirEdicion(t)}
              />
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="gastos__fab" onClick={abrirNuevo} aria-label="Agregar movimiento">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>

      <Modal abierto={modalAbierto} onCerrar={() => setModalAbierto(false)} titulo={editando ? 'Editar movimiento' : 'Nuevo movimiento'}>
        <div className="form-tipo" role="group" aria-label="Tipo de movimiento">
          <button
            type="button"
            className={`form-chip-tipo ${form.tipo === 'gasto' ? 'form-chip-tipo--activo-gasto' : ''}`}
            onClick={() => setForm((f) => ({ ...f, tipo: 'gasto', id_categoria: '' }))}
            aria-pressed={form.tipo === 'gasto'}
          >
            Gasto
          </button>
          <button
            type="button"
            className={`form-chip-tipo ${form.tipo === 'ingreso' ? 'form-chip-tipo--activo-ingreso' : ''}`}
            onClick={() => setForm((f) => ({ ...f, tipo: 'ingreso', id_categoria: '' }))}
            aria-pressed={form.tipo === 'ingreso'}
          >
            Ingreso
          </button>
        </div>

        <CampoMonto
          valor={form.monto}
          onCambiar={(v) => { setForm((f) => ({ ...f, monto: v })); setErrorMonto(undefined); }}
          tipo={form.tipo}
          autoFocus
          error={errorMonto}
        />

        <label className="form-campo">
          <span className="u-subhead">Categoría</span>
          <select
            className="form-select"
            value={form.id_categoria}
            onChange={(e) => setForm((f) => ({ ...f, id_categoria: e.target.value }))}
          >
            <option value="" disabled>Elige una categoría</option>
            {categoriasAgrupadas.sueltas.map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
            ))}
            {categoriasAgrupadas.grupos.map((g) => (
              <optgroup key={g.clave} label={ETIQUETA_GRUPO[g.clave] ?? g.clave}>
                {g.categorias.map((c) => (
                  <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="form-campo">
          <span className="u-subhead">Cuenta</span>
          <select
            className="form-select"
            value={form.id_cuenta}
            onChange={(e) => setForm((f) => ({ ...f, id_cuenta: e.target.value }))}
          >
            <option value="" disabled>Elige una cuenta</option>
            {(cuentas ?? []).map((c) => (
              <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
            ))}
          </select>
        </label>

        <label className="form-campo">
          <span className="u-subhead">Descripción</span>
          <input
            className="form-input"
            type="text"
            value={form.descripcion}
            onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
            placeholder="Ej. Mercado de la semana"
            maxLength={120}
          />
        </label>

        <label className="form-campo">
          <span className="u-subhead">Fecha</span>
          <input
            className="form-input"
            type="date"
            value={form.fecha}
            onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
          />
        </label>

        <div className="form-acciones">
          {editando && (
            <Boton variante="peligro" onClick={() => { setABorrar(editando); setModalAbierto(false); }}>
              Eliminar
            </Boton>
          )}
          <Boton variante="primario" bloque onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </Modal>

      <Confirmacion
        abierto={aBorrar !== null}
        titulo="Eliminar movimiento"
        mensaje={`¿Eliminar "${aBorrar?.descripcion || 'este movimiento'}"? No se puede deshacer.`}
        textoConfirmar="Eliminar"
        peligro
        onConfirmar={confirmarBorrado}
        onCancelar={() => setABorrar(null)}
      />
    </>
  );
}
