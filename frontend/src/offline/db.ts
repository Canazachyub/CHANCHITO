/**
 * Dexie: única fuente de verdad local. La UI lee de aquí (vía hooks en data/api.ts),
 * nunca de la red directamente (README § 6, CONTRACT § 6).
 *
 * Dos espacios compartidos, no personales (CONTRACT § 0.3): todas las tablas de dominio
 * llevan `id_espacio` y se indexan por él para que los hooks de data/api.ts puedan filtrar
 * por el espacio activo sin escanear la tabla entera.
 */
import Dexie, { type Table } from 'dexie';
import type {
  Transaccion,
  Deuda,
  Presupuesto,
  Categoria,
  Cuenta,
  Usuario,
  Conflicto,
  Sesion,
  Espacio,
  SolicitudDinero,
  ObligacionMensual,
} from '../data/types';

export const ESP_FAMILIA = 'ESP_FAMILIA';
export const ESP_TELCOM = 'ESP_TELCOM';
/** Valor legacy de una única versión anterior a los dos espacios (CONTRACT § 0.3). Solo se
 * usa en la migración v3 para reconocer data vieja y no perderla. */
const ESPACIO_LEGACY = 'ESP_COMPARTIDO';

/** Clave en `meta` para el espacio activo (CONTRACT § 6: "se guarda en Dexie y sobrevive
 * al cierre de la app"). Sin selección previa, Familia es el espacio por defecto. */
export const CLAVE_ESPACIO_ACTIVO = 'espacio_activo';

export type TipoOperacion = 'crear' | 'editar' | 'eliminar';
/**
 * 'pago_deuda' viaja en el lote de `sincronizar` (CONTRACT § 4, "Entidad pago_deuda") pero no
 * tiene tabla propia en Dexie: localmente se aplica de forma optimista sobre la DEUDA que paga
 * (data/api.ts registrarPagoDeuda) y las respuestas del servidor (aplicado/conflicto/rechazado)
 * se resuelven también contra esa deuda (offline/sync.ts).
 */
export type EntidadSincronizable = 'transaccion' | 'deuda' | 'presupuesto' | 'pago_deuda';

/**
 * Una mutación pendiente de mandar al servidor (CONTRACT § 4).
 * `seq` autoincremental garantiza el orden FIFO estricto al leer la tabla ordenada por índice.
 * `id_espacio` viaja en cada operación (la cola es compartida en Dexie pero cada mutación
 * pertenece a un solo libro — CONTRACT § 6 "la cola de sincronización... también es por
 * espacio"), lo que permite filtrar `useEstadoSync().pendientes` al espacio que se está
 * mirando sin tener que abrir cada `datos` para leer su id_espacio.
 */
export interface OperacionCola {
  seq?: number;
  op_id: string;
  tipo: TipoOperacion;
  entidad: EntidadSincronizable;
  id: string;
  id_espacio: string;
  rev_base: number | null;
  datos: Record<string, unknown>;
  intentos: number;
  ultimo_error?: string;
  creado_en: string;
}

/** Fila única con la sesión activa; clave fija 'actual'. Vive en Dexie para sobrevivir reinicios offline. */
export interface SesionFila {
  clave: 'actual';
  valor: Sesion;
}

/** Metadatos de sincronización: por ahora solo el `servidor_ts` de la última sync exitosa. */
export interface MetaFila {
  clave: string;
  valor: string;
}

class ChanchitoDB extends Dexie {
  transacciones!: Table<Transaccion, string>;
  deudas!: Table<Deuda, string>;
  presupuestos!: Table<Presupuesto, string>;
  categorias!: Table<Categoria, string>;
  cuentas!: Table<Cuenta, string>;
  usuarios!: Table<Usuario, string>;
  cola!: Table<OperacionCola, number>;
  conflictos!: Table<Conflicto, string>;
  meta!: Table<MetaFila, string>;
  sesion!: Table<SesionFila, string>;
  espacios!: Table<Espacio, string>;
  /** No sincronizable (CONTRACT § 2 nota final): solo cache de lectura offline. */
  solicitudes!: Table<SolicitudDinero, string>;
  /** No sincronizable (CONTRACT § 2 nota final): solo cache de lectura offline. */
  obligaciones!: Table<ObligacionMensual, string>;

  constructor() {
    super('chanchito');

    // v1: esquema inicial. Índices elegidos para las consultas reales de la UI:
    // listado por fecha, filtro por categoría/usuario/cuenta, y colapso de operaciones en la cola.
    // Nota: los campos booleanos (eliminado, activo) y sync_status NO se indexan a propósito —
    // el soporte de IndexedDB para claves booleanas es inconsistente en Safari/iOS, que es
    // justamente la plataforma que más importa para una PWA. Con ~10 usuarios el volumen de datos
    // es chico, así que se filtran en memoria (`.toArray().filter(...)`) en vez de vía índice.
    this.version(1).stores({
      transacciones: 'id_transaccion, fecha, id_categoria, id_usuario, id_cuenta, [id_usuario+fecha], [id_categoria+fecha]',
      deudas: 'id_deuda, id_usuario, estado, fecha_vencimiento',
      presupuestos: 'id_presupuesto, id_categoria, [mes+anio]',
      categorias: 'id_categoria, tipo, orden',
      cuentas: 'id_cuenta, orden',
      usuarios: 'id_usuario, email',
      cola: '++seq, op_id, entidad, id, [entidad+id]',
      conflictos: 'id_conflicto, entidad, id_registro, fecha_detectado',
      meta: 'clave',
      sesion: 'clave',
    });

    // v2: 'rechazado' pasa a ser un sync_status de primera clase en vez de reutilizar
    // 'conflict' con un marcador `__rechazado` escondido dentro de version_servidor
    // (CONTRACT § 6, punto resuelto). Los índices no cambian — sync_status sigue sin
    // indexarse por la misma razón que v1 (soporte inconsistente de claves en Safari/iOS) —
    // así que solo hace falta un `upgrade()` que reescriba los datos ya guardados.
    this.version(2)
      .stores({
        transacciones: 'id_transaccion, fecha, id_categoria, id_usuario, id_cuenta, [id_usuario+fecha], [id_categoria+fecha]',
        deudas: 'id_deuda, id_usuario, estado, fecha_vencimiento',
        presupuestos: 'id_presupuesto, id_categoria, [mes+anio]',
        categorias: 'id_categoria, tipo, orden',
        cuentas: 'id_cuenta, orden',
        usuarios: 'id_usuario, email',
        cola: '++seq, op_id, entidad, id, [entidad+id]',
        conflictos: 'id_conflicto, entidad, id_registro, fecha_detectado',
        meta: 'clave',
        sesion: 'clave',
      })
      .upgrade(async (tx) => {
        // Trae el `entidad`/`id_registro` de cada conflicto que en v1 era en realidad un
        // rechazo (marcado con `version_servidor.__rechazado`), para poder migrar también
        // el sync_status de la fila afectada en su propia tabla.
        const rechazados: Array<{ entidad: string; id: string }> = [];

        await tx
          .table('conflictos')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            const versionServidor = (c.version_servidor as Record<string, unknown> | undefined) ?? {};
            if (versionServidor.__rechazado === true) {
              c.estado = 'rechazado';
              c.error = versionServidor.error ?? 'ERROR_INTERNO';
              c.detalle = versionServidor.detalle ?? '';
              c.version_servidor = {};
              rechazados.push({ entidad: String(c.entidad), id: String(c.id_registro) });
            } else {
              c.estado = 'conflicto';
            }
          });

        const tablaPorEntidad: Record<string, string> = {
          transaccion: 'transacciones',
          deuda: 'deudas',
          presupuesto: 'presupuestos',
        };
        for (const { entidad, id } of rechazados) {
          const nombreTabla = tablaPorEntidad[entidad];
          if (!nombreTabla) continue;
          await tx.table(nombreTabla).update(id, { sync_status: 'rechazado' });
        }
      });

    // v3: dos espacios compartidos en vez de uno (CONTRACT § 0.3). Se agrega `id_espacio`
    // como índice a las tablas de dominio (ya viene en los datos desde antes de esta versión,
    // solo faltaba indexarlo) y se suman las tablas nuevas: `espacios`, y las cachés de lectura
    // de `solicitudes`/`obligaciones` (CONTRACT § 4-bis/4-ter — no son sincronizables, viven
    // acá solo para poder verlas sin conexión).
    this.version(3)
      .stores({
        transacciones:
          'id_transaccion, id_espacio, fecha, id_categoria, id_usuario, id_cuenta, [id_usuario+fecha], [id_categoria+fecha], [id_espacio+fecha]',
        deudas: 'id_deuda, id_espacio, id_usuario, estado, fecha_vencimiento',
        presupuestos: 'id_presupuesto, id_espacio, id_categoria, [mes+anio]',
        categorias: 'id_categoria, id_espacio, tipo, orden, grupo',
        cuentas: 'id_cuenta, id_espacio, orden',
        usuarios: 'id_usuario, email',
        cola: '++seq, op_id, entidad, id, [entidad+id], id_espacio',
        conflictos: 'id_conflicto, entidad, id_registro, fecha_detectado',
        meta: 'clave',
        sesion: 'clave',
        espacios: 'id_espacio',
        solicitudes: 'id_solicitud, id_espacio, estado, id_solicitante',
        obligaciones: 'id_obligacion, id_espacio, activo',
      })
      .upgrade(async (tx) => {
        // Toda la data que ya existía localmente (v1/v2) es de ANTES de que Telcom existiera:
        // se reasigna a Familia en vez de perderse. TODO(contrato): el contrato no dice qué
        // hacer con data preexistente de ESP_COMPARTIDO; se elige conservarla como Familia
        // porque el sistema viejo llevaba el gasto de la casa, no el de la empresa.
        const tablasConEspacio = ['transacciones', 'deudas', 'presupuestos', 'categorias', 'cuentas'];
        for (const nombreTabla of tablasConEspacio) {
          await tx
            .table(nombreTabla)
            .toCollection()
            .modify((fila: Record<string, unknown>) => {
              if (!fila.id_espacio || fila.id_espacio === ESPACIO_LEGACY) {
                fila.id_espacio = ESP_FAMILIA;
              }
            });
        }

        const marca = ahora();
        await tx.table('espacios').bulkPut([
          {
            id_espacio: ESP_FAMILIA,
            nombre: 'Familia',
            descripcion: '',
            id_propietario: '',
            icono: '🏠',
            color: '',
            fecha_creacion: marca,
            activo: true,
          },
          {
            id_espacio: ESP_TELCOM,
            nombre: 'Telcom',
            descripcion: '',
            id_propietario: '',
            icono: '🏢',
            color: '',
            fecha_creacion: marca,
            activo: true,
          },
        ]);

        const metaExistente = await tx.table('meta').get(CLAVE_ESPACIO_ACTIVO);
        if (!metaExistente) {
          await tx.table('meta').put({ clave: CLAVE_ESPACIO_ACTIVO, valor: ESP_FAMILIA });
        }
      });
  }
}

export const db = new ChanchitoDB();

export function generarIdCliente(prefijo: 'TRX' | 'DDA' | 'PRE' | 'PAG'): string {
  // Mismo formato que backend/02_util.js: generateId(prefijo) = prefijo + '_' + 8 hex.
  // crypto.randomUUID() ya viene en hex con guiones; el primer grupo son 8 caracteres hex.
  const hex8 = crypto.randomUUID().split('-')[0];
  return `${prefijo}_${hex8}`;
}

/** El espacio que la UI está mirando ahora mismo. Familia por defecto si nunca se eligió. */
export async function getEspacioActivoId(): Promise<string> {
  const fila = await db.meta.get(CLAVE_ESPACIO_ACTIVO);
  return fila?.valor ?? ESP_FAMILIA;
}

export async function setEspacioActivoId(idEspacio: string): Promise<void> {
  await db.meta.put({ clave: CLAVE_ESPACIO_ACTIVO, valor: idEspacio });
}

export function ahora(): string {
  // yyyy-MM-dd HH:mm:ss, igual formato que fechaHoraActual() del backend (backend/02_util.js).
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
