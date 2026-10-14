import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Categoria, Transaccion } from '../data/types';
import type { Detalle } from '../data/tablero';
import { perteneceAMes } from '../data/analisis';
import {
  editarTransaccion,
  eliminarTransaccion,
  useCuentas,
  useTrabajadores,
  useTransacciones,
  useUsuarios,
} from '../data/api';
import { interpretarMonto } from '../data/importarTrabajadores';
import { db, getEspacioActivoId } from '../offline/db';
import Modal, { Confirmacion } from './Modal';
import Boton from './Boton';
import { formatMoneda } from '../design/format';
import './Formulario.css';

interface Props {
  titulo: string;
  detalle: Detalle;
  /** Valor que muestra la celda: la suma de la lista tiene que coincidir. */
  valorCelda: number;
  onCerrar: () => void;
}

const fechaCorta = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('/');

/**
 * Lista de los movimientos que hay detrás de una cifra del tablero, cada uno corregible en el
 * lugar. Usa las mismas funciones de data/api.ts que la pantalla Gastos: la edición se comporta
 * igual en cualquier ventana o dispositivo.
 */
export default function EditorMovimiento({ titulo, detalle, valorCelda, onCerrar }: Props) {
  // Las categorías inactivas también cuentan en el tablero (useCategorias solo trae activas).
  const categorias = useLiveQuery(async () => {
    const id = await getEspacioActivoId();
    return db.categorias.where('id_espacio').equals(id).toArray();
  }, []);
  const cuentas = useCuentas();
  const usuarios = useUsuarios();
  const trabajadores = useTrabajadores(true);
  const base = useTransacciones({
    mes: detalle.mes,
    anio: detalle.anio,
    ...(detalle.tipo ? { tipo: detalle.tipo } : {}),
    ...(detalle.id_categoria ? { id_categoria: detalle.id_categoria } : {}),
    ...(detalle.id_cuenta ? { id_cuenta: detalle.id_cuenta } : {}),
  });

  const catPorId = useMemo(() => new Map((categorias ?? []).map((c) => [c.id_categoria, c])), [categorias]);
  const lista = useMemo(() => {
    if (!base || !categorias) return undefined;
    return base
      .filter((t) => perteneceAMes(t.fecha, detalle.mes, detalle.anio))
      .filter((t) => (detalle.grupo === undefined ? true : (catPorId.get(t.id_categoria)?.grupo ?? '') === detalle.grupo))
      .filter((t) => (detalle.id_trabajador ? t.id_trabajador === detalle.id_trabajador : true))
      .filter((t) => (detalle.sin_trabajador ? !t.id_trabajador : true))
      .sort((a, b) => (a.fecha + a.hora < b.fecha + b.hora ? 1 : -1));
  }, [base, categorias, catPorId, detalle]);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<Transaccion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suma = (lista ?? []).reduce((s, t) => s + t.monto, 0);
  const cuadra = Math.abs(suma - valorCelda) < 0.005;
  const nombreUsuario = (id: string) => (usuarios ?? []).find((u) => u.id_usuario === id)?.nombre ?? '—';
  const nombreCuenta = (id: string) => (cuentas ?? []).find((c) => c.id_cuenta === id)?.nombre ?? '—';
  const nombreTrabajador = (id?: string) => (id ? (trabajadores ?? []).find((w) => w.id_trabajador === id)?.nombre : undefined);

  async function borrar() {
    if (!aBorrar) return;
    try {
      await eliminarTransaccion(aBorrar.id_transaccion);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
    setABorrar(null);
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo}>
      <div className="editor-mov__total" data-cuadra={cuadra}>
        <span>{lista ? `${lista.length} movimiento${lista.length === 1 ? '' : 's'}` : 'Cargando…'}</span>
        <span className="u-num">
          {formatMoneda(suma)} {cuadra ? <span className="tablero__ok">✓</span> : <span className="tablero__alerta">⚠ no coincide con {formatMoneda(valorCelda)}</span>}
        </span>
      </div>
      {error && <p className="tablero__error" role="alert">{error}</p>}

      {lista && lista.length === 0 && <p className="u-footnote">No hay movimientos.</p>}
      <ul className="editor-mov__lista">
        {(lista ?? []).map((t) => {
          const cat = catPorId.get(t.id_categoria);
          const trab = nombreTrabajador(t.id_trabajador);
          return (
            <li key={t.id_transaccion} className="editor-mov__item">
              <button
                type="button"
                className="editor-mov__fila"
                onClick={() => setAbierta(abierta === t.id_transaccion ? null : t.id_transaccion)}
                aria-expanded={abierta === t.id_transaccion}
              >
                <span className="editor-mov__fecha u-num">{fechaCorta(t.fecha)}</span>
                <span className="editor-mov__texto">
                  <span>{t.descripcion || cat?.nombre || 'Sin descripción'}</span>
                  <span className="u-footnote">
                    {[cat?.nombre, trab, nombreCuenta(t.id_cuenta), nombreUsuario(t.id_usuario)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="u-num editor-mov__monto">{formatMoneda(t.monto)}</span>
              </button>
              {abierta === t.id_transaccion && (
                <FormularioFila
                  t={t}
                  categorias={(categorias ?? []).filter((c) => c.tipo === t.tipo && (c.activo || c.id_categoria === t.id_categoria))}
                  cuentas={cuentas ?? []}
                  trabajadores={(trabajadores ?? []).filter((w) => w.activo || w.id_trabajador === t.id_trabajador)}
                  onGuardado={() => setAbierta(null)}
                  onBorrar={() => setABorrar(t)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <Confirmacion
        abierto={aBorrar !== null}
        titulo="Eliminar movimiento"
        mensaje={aBorrar ? `Se eliminará "${aBorrar.descripcion || 'sin descripción'}" por ${formatMoneda(aBorrar.monto)}. Los totales se recalculan.` : ''}
        textoConfirmar="Eliminar"
        peligro
        onConfirmar={borrar}
        onCancelar={() => setABorrar(null)}
      />
    </Modal>
  );
}

interface FormProps {
  t: Transaccion;
  categorias: Categoria[];
  cuentas: Array<{ id_cuenta: string; nombre: string }>;
  trabajadores: Array<{ id_trabajador: string; nombre: string; activo: boolean }>;
  onGuardado: () => void;
  onBorrar: () => void;
}

function FormularioFila({ t, categorias, cuentas, trabajadores, onGuardado, onBorrar }: FormProps) {
  const [monto, setMonto] = useState(String(t.monto));
  const [idCategoria, setIdCategoria] = useState(t.id_categoria);
  const [idCuenta, setIdCuenta] = useState(t.id_cuenta);
  const [idTrabajador, setIdTrabajador] = useState(t.id_trabajador ?? '');
  const [descripcion, setDescripcion] = useState(t.descripcion);
  const [fecha, setFecha] = useState(t.fecha);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const esPersonal = categorias.find((c) => c.id_categoria === idCategoria)?.grupo === 'personal';

  async function guardar() {
    const valor = interpretarMonto(monto);
    if (!Number.isFinite(valor) || valor <= 0) return setError('Ingresa un monto válido, mayor que cero.');
    if (!idCategoria || !idCuenta || !fecha) return setError('Completa categoría, cuenta y fecha.');
    setGuardando(true);
    try {
      await editarTransaccion(t.id_transaccion, {
        monto: valor,
        id_categoria: idCategoria,
        id_cuenta: idCuenta,
        descripcion,
        fecha,
        // Fuera de personal no hay trabajador: si cambian la categoría, no queda colgado.
        id_trabajador: esPersonal ? idTrabajador : '',
      });
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="editor-mov__form">
      <label className="form-campo">
        <span className="u-subhead">Monto</span>
        <input className="form-input u-num" inputMode="decimal" value={monto} onChange={(e) => { setMonto(e.target.value); setError(null); }} />
      </label>
      <label className="form-campo">
        <span className="u-subhead">Categoría</span>
        <select className="form-select" value={idCategoria} onChange={(e) => setIdCategoria(e.target.value)}>
          {categorias.map((c) => (
            <option key={c.id_categoria} value={c.id_categoria}>{c.icono} {c.nombre}</option>
          ))}
        </select>
      </label>
      {esPersonal && (
        <label className="form-campo">
          <span className="u-subhead">Trabajador</span>
          <select className="form-select" value={idTrabajador} onChange={(e) => setIdTrabajador(e.target.value)}>
            <option value="">Sin asignar</option>
            {trabajadores.map((w) => (
              <option key={w.id_trabajador} value={w.id_trabajador}>{w.nombre}{w.activo ? '' : ' (de baja)'}</option>
            ))}
          </select>
        </label>
      )}
      <label className="form-campo">
        <span className="u-subhead">Cuenta</span>
        <select className="form-select" value={idCuenta} onChange={(e) => setIdCuenta(e.target.value)}>
          {cuentas.map((c) => (
            <option key={c.id_cuenta} value={c.id_cuenta}>{c.nombre}</option>
          ))}
        </select>
      </label>
      <label className="form-campo">
        <span className="u-subhead">Descripción</span>
        <input className="form-input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </label>
      <label className="form-campo">
        <span className="u-subhead">Fecha</span>
        <input className="form-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </label>
      {error && <p className="tablero__error" role="alert">{error}</p>}
      <div className="editor-mov__acciones">
        <Boton variante="peligro" tamano="chico" type="button" onClick={onBorrar}>Eliminar</Boton>
        <Boton tamano="chico" type="button" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Boton>
      </div>
    </div>
  );
}
