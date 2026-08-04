import type { Categoria, Transaccion, Usuario } from '../data/types';
import { formatMontoConSigno } from '../design/format';
import './FilaTransaccion.css';

interface FilaTransaccionProps {
  transaccion: Transaccion;
  categoria?: Categoria;
  usuario?: Usuario;
  onSeleccionar?: () => void;
}

/**
 * Fila de lista para Gastos. El indicador de sync_status='pending' es un
 * punto tenue en la esquina del ícono de categoría — visible si te fijas,
 * invisible si no te importa. Nada de banners ni colores de alarma: el
 * contrato pide "discreto".
 */
export default function FilaTransaccion({ transaccion, categoria, usuario, onSeleccionar }: FilaTransaccionProps) {
  const esGasto = transaccion.tipo === 'gasto';
  const pendiente = transaccion.sync_status === 'pending';

  return (
    <li className="fila-transaccion">
      <button
        type="button"
        className="fila-transaccion__boton"
        onClick={onSeleccionar}
        aria-label={`${categoria?.nombre ?? 'Sin categoría'}, ${transaccion.descripcion || 'sin descripción'}, ${formatMontoConSigno(transaccion.monto, transaccion.tipo)}`}
      >
        <span
          className="fila-transaccion__icono"
          style={{ background: categoria ? `${categoria.color}26` : 'var(--text-08)' }}
          aria-hidden="true"
        >
          {categoria?.icono ?? '•'}
          {pendiente && <span className="fila-transaccion__pendiente" title="Pendiente de sincronizar" />}
        </span>

        <span className="fila-transaccion__detalle">
          <span className="u-callout fila-transaccion__descripcion">
            {transaccion.descripcion || categoria?.nombre || 'Sin descripción'}
          </span>
          <span className="u-footnote">{usuario?.nombre ?? '—'}</span>
        </span>

        <span className={`u-amount u-num fila-transaccion__monto ${esGasto ? 'u-expense' : 'u-income'}`}>
          {formatMontoConSigno(transaccion.monto, transaccion.tipo)}
        </span>
      </button>
    </li>
  );
}
