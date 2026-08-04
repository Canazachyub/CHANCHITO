/**
 * Cola de operaciones pendientes (CONTRACT § 4). FIFO estricto: se lee siempre ordenada
 * por `seq` (autoincrement de Dexie), que es el orden de inserción.
 *
 * Colapso de operaciones: si ya hay una operación pendiente para la misma entidad+id,
 * en vez de apilar una segunda operación (que rompería el `rev_base` y podría mandar
 * dos escrituras fuera de orden relativo entre sí) se fusiona sobre la existente:
 *  - crear + editar (antes de sincronizar) → se funde en la misma operación "crear".
 *  - editar + editar → se funde: se conservan los `datos` más nuevos pero el `rev_base`
 *    original (el primero que se vio), porque es contra esa rev que el servidor debe comparar.
 *  - cualquier cosa + eliminar → la operación se reemplaza por "eliminar" (gana el borrado).
 */
import { db, type OperacionCola, type TipoOperacion, type EntidadSincronizable, ahora } from './db';

export async function encolar(
  tipo: TipoOperacion,
  entidad: EntidadSincronizable,
  id: string,
  datos: Record<string, unknown>,
  revBase: number | null,
  idEspacio: string,
): Promise<void> {
  await db.transaction('rw', db.cola, async () => {
    const existente = await db.cola.where('[entidad+id]').equals([entidad, id]).first();

    if (!existente) {
      const op: OperacionCola = {
        op_id: crypto.randomUUID(),
        tipo,
        entidad,
        id,
        id_espacio: idEspacio,
        rev_base: revBase,
        datos,
        intentos: 0,
        creado_en: ahora(),
      };
      await db.cola.add(op);
      return;
    }

    if (tipo === 'eliminar') {
      // El borrado gana sobre cualquier crear/editar pendiente anterior para el mismo registro.
      if (existente.tipo === 'crear') {
        // Nunca llegó a existir en el servidor: no hace falta avisarle, se descarta la cola entera.
        await db.cola.delete(existente.seq!);
        return;
      }
      await db.cola.update(existente.seq!, { tipo: 'eliminar', datos, intentos: 0, ultimo_error: undefined });
      return;
    }

    if (existente.tipo === 'crear') {
      // Todavía no viajó al servidor: la edición se funde en los mismos datos del "crear".
      await db.cola.update(existente.seq!, { datos: { ...existente.datos, ...datos } });
      return;
    }

    // editar sobre editar (o editar sobre eliminar, caso raro): se conserva el rev_base original.
    await db.cola.update(existente.seq!, {
      tipo: 'editar',
      datos: { ...existente.datos, ...datos },
    });
  });
}

/** Lista la cola en orden FIFO estricto. */
export async function listarCola(): Promise<OperacionCola[]> {
  return db.cola.orderBy('seq').toArray();
}

export async function contarPendientes(): Promise<number> {
  return db.cola.count();
}

/** Pendientes de un solo espacio — lo que muestra useEstadoSync() para no mezclar el
 * contador de "faltan sincronizar N" de un libro con el del otro. */
export async function contarPendientesPorEspacio(idEspacio: string): Promise<number> {
  return db.cola.where('id_espacio').equals(idEspacio).count();
}

export async function quitarDeCola(opId: string): Promise<void> {
  await db.cola.where('op_id').equals(opId).delete();
}

export async function registrarErrorEnCola(opId: string, mensaje: string): Promise<void> {
  const fila = await db.cola.where('op_id').equals(opId).first();
  if (!fila) return;
  await db.cola.update(fila.seq!, { intentos: fila.intentos + 1, ultimo_error: mensaje });
}

/** true si todavía queda una operación en la cola para esa entidad+id (de cualquier tipo). */
export async function hayOperacionPendiente(entidad: EntidadSincronizable, id: string): Promise<boolean> {
  const op = await db.cola.where('[entidad+id]').equals([entidad, id]).first();
  return op !== undefined;
}
