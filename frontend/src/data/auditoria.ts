/**
 * Auditoría del libro — lógica PURA.
 *
 * Revisa el espacio activo y devuelve hallazgos priorizados: lo que no cuadra, lo que vence,
 * lo que falta registrar y lo que parece un error de carga. Cada hallazgo dice dónde ir a
 * corregirlo, así la pantalla de auditoría es una lista de pendientes y no un informe muerto.
 */
import type { Categoria, Deuda, ObligacionMensual, Trabajador, Transaccion } from './types';
import type { Tablero } from './tablero';
import { diasEntre, perteneceAMes } from './analisis';

export type Severidad = 'alta' | 'media' | 'baja';
export type Destino = 'resumen' | 'gastos' | 'deudas' | 'tablero' | 'admin';

export interface Hallazgo {
  id: string;
  severidad: Severidad;
  titulo: string;
  detalle: string;
  /** Monto involucrado, si aplica. */
  monto?: number;
  destino: Destino;
  /** Ids concretos para que la pantalla de destino los resalte o filtre. */
  ids?: string[];
}

export interface EntradaAuditoria {
  transacciones: Transaccion[];
  categorias: Categoria[];
  deudas: Deuda[];
  trabajadores: Trabajador[];
  obligaciones: ObligacionMensual[];
  tablero?: Tablero;
  pendientesSync: number;
  conflictos: number;
  mes: number;
  anio: number;
  hoy: string;
}

const ORDEN: Record<Severidad, number> = { alta: 0, media: 1, baja: 2 };
const DIAS_AVISO_CONTRATO = 45;
const DIAS_AVISO_DEUDA = 7;
/** Un gasto es atípico si supera esto × la mediana de su categoría (con historia suficiente). */
const FACTOR_ATIPICO = 4;
const MINIMO_HISTORIA = 5;

function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function auditar(e: EntradaAuditoria): Hallazgo[] {
  const h: Hallazgo[] = [];
  const catPorId = new Map(e.categorias.map((c) => [c.id_categoria, c]));
  const delMes = e.transacciones.filter((t) => perteneceAMes(t.fecha, e.mes, e.anio));

  // 1. Controles del tablero que no dan cero: las hojas no cuadran entre sí.
  for (const hoja of e.tablero?.hojas ?? []) {
    for (const fila of hoja.filas) {
      if (fila.tipo !== 'control' || !fila.etiqueta.startsWith('Diferencia')) continue;
      for (const c of fila.celdas) {
        if (typeof c.v === 'number' && Math.abs(c.v) >= 0.005) {
          h.push({
            id: `control-${hoja.id}`,
            severidad: 'alta',
            titulo: `${hoja.titulo} no cuadra con Resultados`,
            detalle:
              hoja.id === 'Planilla'
                ? 'Hay pagos a trabajadores registrados en categorías que no son de personal.'
                : 'Hay movimientos en cuentas dadas de baja o sin cuenta.',
            monto: c.v,
            destino: 'tablero',
          });
          break;
        }
      }
    }
  }

  // 2. Deudas vencidas (incluye cuotas de préstamo y planilla).
  const abiertas = e.deudas.filter((d) => d.estado !== 'pagada' && d.monto_pendiente > 0);
  const vencidas = abiertas.filter((d) => d.fecha_vencimiento && d.fecha_vencimiento < e.hoy);
  const debo = vencidas.filter((d) => d.tipo === 'debo');
  if (debo.length) {
    h.push({
      id: 'vencidas-debo',
      severidad: 'alta',
      titulo: `${plural(debo.length, 'pago vencido', 'pagos vencidos')}`,
      detalle: debo.slice(0, 3).map((d) => d.persona).join(', ') + (debo.length > 3 ? '…' : '') + '. Págalos o corrige la fecha si ya se pagaron.',
      monto: suma(debo.map((d) => d.monto_pendiente)),
      destino: 'deudas',
      ids: debo.map((d) => d.id_deuda),
    });
  }
  const cobrar = vencidas.filter((d) => d.tipo === 'me_deben');
  if (cobrar.length) {
    h.push({
      id: 'vencidas-cobrar',
      severidad: 'media',
      titulo: `${plural(cobrar.length, 'cobro vencido', 'cobros vencidos')}`,
      detalle: cobrar.slice(0, 3).map((d) => d.persona).join(', ') + '.',
      monto: suma(cobrar.map((d) => d.monto_pendiente)),
      destino: 'deudas',
      ids: cobrar.map((d) => d.id_deuda),
    });
  }

  // 3. Lo que vence esta semana.
  const proximas = abiertas.filter((d) => d.tipo === 'debo' && d.fecha_vencimiento && d.fecha_vencimiento >= e.hoy && diasEntre(e.hoy, d.fecha_vencimiento) <= DIAS_AVISO_DEUDA);
  if (proximas.length) {
    h.push({
      id: 'vence-semana',
      severidad: 'media',
      titulo: `${plural(proximas.length, 'pago vence', 'pagos vencen')} en los próximos ${DIAS_AVISO_DEUDA} días`,
      detalle: proximas.map((d) => `${d.persona} (${d.fecha_vencimiento.slice(8)}/${d.fecha_vencimiento.slice(5, 7)})`).slice(0, 4).join(', '),
      monto: suma(proximas.map((d) => d.monto_pendiente)),
      destino: 'deudas',
      ids: proximas.map((d) => d.id_deuda),
    });
  }

  // 4. Contratos por vencer o vencidos.
  for (const w of e.trabajadores.filter((x) => x.activo && x.fecha_fin)) {
    const dias = diasEntre(e.hoy, w.fecha_fin);
    if (dias > DIAS_AVISO_CONTRATO) continue;
    h.push({
      id: `contrato-${w.id_trabajador}`,
      severidad: dias < 0 ? 'alta' : dias <= 15 ? 'alta' : 'media',
      titulo: dias < 0 ? `Contrato vencido: ${w.nombre}` : `Contrato de ${w.nombre} vence en ${dias} días`,
      detalle: dias < 0 ? 'Sigue activo sin contrato vigente: renuévalo o dalo de baja.' : 'La renovación tiene que ser por escrito antes del vencimiento.',
      destino: 'admin',
      ids: [w.id_trabajador],
    });
  }

  // 5. Datos incompletos de planilla (lo que pide SUNAT/PLAME).
  const enPlanilla = e.trabajadores.filter((w) => w.activo && w.tipo_vinculo === 'planilla');
  const sinPension = enPlanilla.filter((w) => !w.pension);
  if (sinPension.length) {
    h.push({ id: 'sin-pension', severidad: 'media', titulo: `${plural(sinPension.length, 'trabajador', 'trabajadores')} en planilla sin ONP/AFP`, detalle: 'Hace falta para calcular retenciones de la PLAME.', destino: 'admin', ids: sinPension.map((w) => w.id_trabajador) });
  }
  const sinSueldo = enPlanilla.filter((w) => !w.sueldo_base);
  if (sinSueldo.length) {
    h.push({ id: 'sin-sueldo', severidad: 'media', titulo: `${plural(sinSueldo.length, 'trabajador', 'trabajadores')} en planilla sin sueldo base`, detalle: sinSueldo.map((w) => w.nombre).join(', ') + '. Sin sueldo no se programa su pago.', destino: 'admin', ids: sinSueldo.map((w) => w.id_trabajador) });
  }
  const sinDni = e.trabajadores.filter((w) => w.activo && !w.documento);
  if (sinDni.length) {
    h.push({ id: 'sin-dni', severidad: 'baja', titulo: `${plural(sinDni.length, 'trabajador', 'trabajadores')} sin DNI`, detalle: sinDni.map((w) => w.nombre).join(', '), destino: 'admin', ids: sinDni.map((w) => w.id_trabajador) });
  }

  // 6. Lo marcado para verificar en notas o descripciones.
  const porVerificar = [
    ...e.trabajadores.filter((w) => w.activo && /\[VERIFICAR\]/i.test(w.notas)).map((w) => ({ id: w.id_trabajador, txt: w.nombre, destino: 'admin' as const })),
    ...abiertas.filter((d) => /\[VERIFICAR\]/i.test(`${d.descripcion} ${d.notas}`)).map((d) => ({ id: d.id_deuda, txt: d.persona, destino: 'deudas' as const })),
  ];
  if (porVerificar.length) {
    h.push({ id: 'verificar', severidad: 'baja', titulo: `${plural(porVerificar.length, 'dato marcado', 'datos marcados')} [VERIFICAR]`, detalle: porVerificar.map((x) => x.txt).slice(0, 5).join(', '), destino: porVerificar[0].destino, ids: porVerificar.map((x) => x.id) });
  }

  // 7. Pagos de personal sin trabajador: la planilla por persona queda incompleta.
  const personalSinTrabajador = delMes.filter((t) => t.tipo === 'gasto' && catPorId.get(t.id_categoria)?.grupo === 'personal' && !t.id_trabajador);
  if (personalSinTrabajador.length) {
    h.push({ id: 'personal-sin-trabajador', severidad: 'media', titulo: `${plural(personalSinTrabajador.length, 'pago de personal', 'pagos de personal')} sin trabajador`, detalle: 'Asígnalos para que la ficha de cada uno y la planilla cuadren.', monto: suma(personalSinTrabajador.map((t) => t.monto)), destino: 'gastos', ids: personalSinTrabajador.map((t) => t.id_transaccion) });
  }

  // 8. Posibles duplicados: mismo monto, fecha, categoría y cuenta.
  const grupos = new Map<string, Transaccion[]>();
  for (const t of delMes) {
    const clave = `${t.tipo}|${t.fecha}|${t.monto}|${t.id_categoria}|${t.id_cuenta}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(t);
  }
  const duplicados = Array.from(grupos.values()).filter((g) => g.length > 1);
  if (duplicados.length) {
    h.push({ id: 'duplicados', severidad: 'media', titulo: `${plural(duplicados.length, 'posible duplicado', 'posibles duplicados')}`, detalle: 'Mismo monto, día, categoría y cuenta. Revisa si se registró dos veces (por ejemplo, desde el bot y la app).', monto: suma(duplicados.map((g) => g[0].monto * (g.length - 1))), destino: 'gastos', ids: duplicados.flat().map((t) => t.id_transaccion) });
  }

  // 9. Gastos atípicos para su categoría (posible error de tipeo: 1500 en vez de 150).
  const historia = new Map<string, number[]>();
  for (const t of e.transacciones) {
    if (t.tipo !== 'gasto' || perteneceAMes(t.fecha, e.mes, e.anio)) continue;
    if (!historia.has(t.id_categoria)) historia.set(t.id_categoria, []);
    historia.get(t.id_categoria)!.push(t.monto);
  }
  const atipicos = delMes.filter((t) => {
    const hist = historia.get(t.id_categoria);
    return t.tipo === 'gasto' && hist && hist.length >= MINIMO_HISTORIA && t.monto > FACTOR_ATIPICO * mediana(hist);
  });
  if (atipicos.length) {
    h.push({ id: 'atipicos', severidad: 'baja', titulo: `${plural(atipicos.length, 'gasto fuera de lo normal', 'gastos fuera de lo normal')}`, detalle: atipicos.slice(0, 3).map((t) => `${catPorId.get(t.id_categoria)?.nombre ?? '?'}: ${t.monto}`).join(', ') + `. Más de ${FACTOR_ATIPICO} veces lo habitual de su categoría.`, destino: 'gastos', ids: atipicos.map((t) => t.id_transaccion) });
  }

  // 10. Obligaciones activas sin generar este mes.
  const periodo = `${e.anio}-${String(e.mes).padStart(2, '0')}`;
  const sinGenerar = e.obligaciones.filter((o) => o.activo && !o.eliminado && o.ultimo_periodo_generado !== periodo);
  if (sinGenerar.length && e.hoy.startsWith(periodo)) {
    h.push({ id: 'obligaciones-sin-generar', severidad: 'media', titulo: `${plural(sinGenerar.length, 'obligación', 'obligaciones')} del mes sin generar`, detalle: sinGenerar.map((o) => o.concepto).slice(0, 4).join(', ') + '. ¿Está activo el trigger diario?', destino: 'admin', ids: sinGenerar.map((o) => o.id_obligacion) });
  }

  // 11. Sincronización: lo que todavía no está en Sheets no está auditado.
  if (e.conflictos > 0) {
    h.push({ id: 'conflictos', severidad: 'alta', titulo: `${plural(e.conflictos, 'conflicto', 'conflictos')} de sincronización`, detalle: 'Dos personas editaron lo mismo. Resuélvelos para que todos vean los mismos números.', destino: 'resumen' });
  }
  if (e.pendientesSync > 0) {
    h.push({ id: 'pendientes-sync', severidad: 'baja', titulo: `${plural(e.pendientesSync, 'cambio sin subir', 'cambios sin subir')} a Sheets`, detalle: 'Se suben solos al haber conexión.', destino: 'resumen' });
  }

  return h.sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || (b.monto ?? 0) - (a.monto ?? 0));
}
