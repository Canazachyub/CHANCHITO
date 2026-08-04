/**
 * UI de resolución de conflictos (CONTRACT § 4 y § 6, README § 6). Se renderiza arriba de todo
 * en App.tsx y devuelve `null` si no hay nada pendiente, así que no le agrega ni un pixel a la
 * pantalla cuando todo está sincronizado (que es el caso normal con ~10 usuarios editando
 * mayormente lo suyo).
 *
 * Dos formas de tarjeta, distinguidas por `Conflicto.estado` (campo explícito, no un marcador
 * escondido — ver data/types.ts):
 * - 'conflicto' (rev_base !== rev del servidor): lado a lado, campo por campo, resaltando
 *   los que difieren, con "Usar la mía" / "Usar la del servidor".
 * - 'rechazado' (ver offline/sync.ts): no hay "versión del servidor" que mostrar porque la
 *   operación nunca se aplicó (ej. MONTO_INVALIDO); se muestra el error del servidor y se ofrece
 *   "Corregir" (deja el dato local para editarlo desde Gastos/Deudas) o "Descartar".
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../offline/db';
import { resolverConflicto, type EleccionConflicto } from '../offline/sync';
import type { Conflicto } from '../data/types';
import '../offline/conflictos.css';

const CAMPOS_OCULTOS = new Set(['sync_status', 'rev_base']);
const CAMPOS_MONTO = new Set(['monto', 'monto_original', 'monto_pendiente', 'monto_limite']);

const NOMBRE_ENTIDAD: Record<Conflicto['entidad'], string> = {
  transaccion: 'la transacción',
  deuda: 'la deuda',
  presupuesto: 'el presupuesto',
};

export default function Conflictos(): JSX.Element | null {
  const conflictos = useLiveQuery(() => db.conflictos.orderBy('fecha_detectado').toArray());

  if (!conflictos || conflictos.length === 0) return null;

  return (
    <section className="conflictos" aria-label="Conflictos de sincronización">
      {conflictos.map((c) => (
        <TarjetaConflicto key={c.id_conflicto} conflicto={c} />
      ))}
    </section>
  );
}

function TarjetaConflicto({ conflicto }: { conflicto: Conflicto }): JSX.Element {
  const [resolviendo, setResolviendo] = useState(false);

  async function elegir(eleccion: EleccionConflicto): Promise<void> {
    setResolviendo(true);
    try {
      await resolverConflicto(conflicto, eleccion);
    } finally {
      setResolviendo(false);
    }
  }

  if (conflicto.estado === 'rechazado') {
    return (
      <div className="conflicto-tarjeta conflicto-tarjeta--rechazo">
        <p className="conflicto-titulo">No se pudo guardar {NOMBRE_ENTIDAD[conflicto.entidad]}</p>
        <p className="conflicto-error">
          {conflicto.error ?? 'ERROR_INTERNO'}
          {conflicto.detalle ? `: ${conflicto.detalle}` : ''}
        </p>
        <div className="conflicto-acciones">
          <button
            type="button"
            className="conflicto-boton conflicto-boton--corregir"
            onClick={() => elegir('corregir')}
            disabled={resolviendo}
          >
            Corregir
          </button>
          <button
            type="button"
            className="conflicto-boton conflicto-boton--descartar"
            onClick={() => elegir('servidor')}
            disabled={resolviendo}
          >
            Descartar
          </button>
        </div>
      </div>
    );
  }

  const campos = Array.from(
    new Set([...Object.keys(conflicto.version_cliente), ...Object.keys(conflicto.version_servidor)]),
  ).filter((campo) => !CAMPOS_OCULTOS.has(campo));

  return (
    <div className="conflicto-tarjeta">
      <p className="conflicto-titulo">Conflicto en {NOMBRE_ENTIDAD[conflicto.entidad]}</p>
      <p className="conflicto-subtitulo">Alguien más editó este registro al mismo tiempo. Elegí qué versión queda.</p>
      <div className="conflicto-comparacion">
        <div className="conflicto-columna">
          <p className="conflicto-columna-titulo">La mía</p>
          {campos.map((campo) => (
            <FilaCampo
              key={campo}
              nombre={campo}
              valor={conflicto.version_cliente[campo]}
              difiere={difiere(conflicto, campo)}
            />
          ))}
        </div>
        <div className="conflicto-columna">
          <p className="conflicto-columna-titulo">La del servidor</p>
          {campos.map((campo) => (
            <FilaCampo
              key={campo}
              nombre={campo}
              valor={conflicto.version_servidor[campo]}
              difiere={difiere(conflicto, campo)}
            />
          ))}
        </div>
      </div>
      <div className="conflicto-acciones">
        <button type="button" className="conflicto-boton conflicto-boton--mia" onClick={() => elegir('mia')} disabled={resolviendo}>
          Usar la mía
        </button>
        <button
          type="button"
          className="conflicto-boton conflicto-boton--servidor"
          onClick={() => elegir('servidor')}
          disabled={resolviendo}
        >
          Usar la del servidor
        </button>
      </div>
    </div>
  );
}

function FilaCampo({ nombre, valor, difiere }: { nombre: string; valor: unknown; difiere: boolean }): JSX.Element {
  const esMonto = CAMPOS_MONTO.has(nombre);
  return (
    <div className={`conflicto-campo${difiere ? ' conflicto-campo--difiere' : ''}`}>
      <span className="conflicto-campo-nombre">{nombre}</span>
      <span className={`conflicto-campo-valor${esMonto ? ' conflicto-campo-valor--monto' : ''}`}>
        {formatearValor(valor)}
      </span>
    </div>
  );
}

function difiere(conflicto: Conflicto, campo: string): boolean {
  return JSON.stringify(conflicto.version_cliente[campo]) !== JSON.stringify(conflicto.version_servidor[campo]);
}

function formatearValor(valor: unknown): string {
  if (valor === undefined || valor === null || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no';
  return String(valor);
}
