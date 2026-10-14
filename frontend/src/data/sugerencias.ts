/**
 * Sugerencias de qué registrar o pagar — lógica PURA.
 *
 * Al tocar una categoría (o un grupo) en la rueda del inicio, la app no abre un formulario
 * vacío: propone lo que probablemente vas a registrar. Las fuentes van en este orden de
 * prioridad:
 *  1. Lo que se debe y vence (obligaciones del mes, cuotas de préstamo, planilla): se paga con
 *     un toque y queda enlazado a la deuda.
 *  2. Trabajadores, si la categoría es de personal.
 *  3. Lo que ya se pagó antes en esa categoría, con el último monto ("como la última vez").
 *  4. Plantillas comunes en Perú para cuando todavía no hay historia.
 */
import type { Categoria, Deuda, ObligacionMensual, Trabajador, Transaccion } from './types';
import { diasEntre } from './analisis';

export type TipoSugerencia = 'pagar' | 'trabajador' | 'repetir' | 'plantilla';

export interface Sugerencia {
  /** Estable para usar como key de React. */
  id: string;
  tipo: TipoSugerencia;
  titulo: string;
  /** Segunda línea: "vence en 3 días", "última vez S/ 59.54 · 12 sep"… */
  detalle: string;
  id_categoria: string;
  /** Texto que va a la descripción del movimiento. */
  descripcion: string;
  monto?: number;
  id_deuda?: string;
  id_trabajador?: string;
  urgencia?: 'vencido' | 'pronto';
}

/** Cómo se llaman los pagos de todos los días en cada categoría de sistema (backend/00_config.js). */
const PLANTILLAS: Record<string, string[]> = {
  // Familia
  comida: ['Mercado', 'Almuerzo', 'Panadería', 'Delivery'],
  transporte: ['Pasaje', 'Taxi', 'Combustible', 'Estacionamiento'],
  'gastos fijos': ['Alquiler', 'Mantenimiento', 'Cuota del colegio'],
  servicios: ['Luz', 'Agua', 'Internet', 'Celular', 'Gas', 'Cable'],
  salud: ['Farmacia', 'Consulta médica', 'Análisis'],
  educacion: ['Pensión', 'Útiles', 'Matrícula'],
  entretenimiento: ['Salida', 'Streaming', 'Cine'],
  // Telcom
  'notaria y tramites': ['Legalización', 'Copia literal SUNARP', 'Trámite municipal'],
  'servicios tecnicos': ['Mantenimiento', 'Reparación de equipo'],
  viaticos: ['Alimentación en campo', 'Hospedaje'],
  'pasajes y transporte': ['Pasaje interprovincial', 'Taxi', 'Movilidad local'],
  'materiales de trabajo': ['Materiales', 'Herramientas', 'EPP'],
  combustible: ['Gasolina', 'Diésel'],
  'alquiler de oficina': ['Alquiler de oficina'],
  'servicios de oficina': ['Luz', 'Agua', 'Internet', 'Telefonía'],
  essalud: ['EsSalud del mes'],
  seguros: ['SCTR', 'Vida Ley'],
  'utiles de oficina': ['Papelería', 'Tinta / tóner'],
  'equipos de computo': ['Laptop', 'Impresora', 'Accesorios'],
  'impuestos y sunat': ['PDT 621 (IGV y renta)', 'PLAME', 'Multa SUNAT', 'Detracción'],
  'intereses y comisiones bancarias': ['Comisión bancaria', 'ITF'],
};

/** 'Educación' → 'educacion': sin tildes ni mayúsculas, para comparar nombres. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const PREFIJO_OBLIGACION = 'Obligación mensual:';

/**
 * Deudas sueltas (no vienen de una obligación ni de un préstamo) que igual pertenecen a una
 * categoría por a quién se le debe. Sin esto, una multa de SUNAT vencida no aparecía al tocar
 * "Impuestos", que es justo donde uno la busca.
 */
const PALABRAS_CATEGORIA: Record<string, string[]> = {
  'impuestos y sunat': ['sunat', 'igv', 'renta', 'plame', 'onp', 'essalud', 'detraccion', 'multa'],
  essalud: ['essalud'],
  servicios: ['luz', 'agua', 'internet', 'claro', 'movistar', 'entel', 'bitel', 'sedapal', 'enel', 'electro'],
  'servicios de oficina': ['luz', 'agua', 'internet', 'claro', 'movistar', 'entel', 'bitel', 'telefon'],
  'alquiler de oficina': ['alquiler'],
  'gastos fijos': ['alquiler', 'mantenimiento'],
};

export interface EntradaSugerencias {
  /** Una categoría o varias (todas las de un grupo). */
  categorias: Categoria[];
  transacciones: Transaccion[];
  deudas: Deuda[];
  obligaciones: ObligacionMensual[];
  trabajadores: Trabajador[];
  /** 'yyyy-MM-dd'. */
  hoy: string;
  /** Hasta cuántos días adelante se ofrece pagar algo que vence. */
  diasAviso?: number;
  maximo?: number;
}

function formatoMonto(m: number): string {
  return `S/ ${m.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function textoVence(dias: number): string {
  if (dias < 0) return `venció hace ${-dias} día${dias === -1 ? '' : 's'}`;
  if (dias === 0) return 'vence hoy';
  return `vence en ${dias} día${dias === 1 ? '' : 's'}`;
}

/** Deudas que pertenecen a estas categorías: por obligación mensual o por préstamo. */
function deudasDeCategorias(e: EntradaSugerencias, ids: Set<string>): Array<{ deuda: Deuda; id_categoria: string }> {
  const nombres = new Set(e.categorias.map((c) => normalizar(c.nombre)));
  const esFinanciero = nombres.has('amortizacion de prestamos') || nombres.has('intereses y comisiones bancarias');
  const salida: Array<{ deuda: Deuda; id_categoria: string }> = [];

  for (const d of e.deudas) {
    if (d.tipo !== 'debo' || d.estado === 'pagada' || d.monto_pendiente <= 0 || d.eliminado) continue;
    if (d.id_prestamo) {
      // Las cuotas reparten interés y capital entre dos categorías: se ofrecen en cualquiera de las dos.
      if (esFinanciero) salida.push({ deuda: d, id_categoria: e.categorias[0].id_categoria });
      continue;
    }
    if (!d.descripcion.startsWith(PREFIJO_OBLIGACION)) {
      const texto = normalizar(`${d.persona} ${d.descripcion}`);
      const cat = e.categorias.find((c) => (PALABRAS_CATEGORIA[normalizar(c.nombre)] ?? []).some((p) => texto.includes(p)));
      if (cat) salida.push({ deuda: d, id_categoria: cat.id_categoria });
      continue;
    }
    const concepto = d.descripcion.slice(PREFIJO_OBLIGACION.length).trim();
    const obligacion = e.obligaciones.find((o) => o.concepto === concepto && !o.eliminado);
    if (obligacion && ids.has(obligacion.id_categoria)) salida.push({ deuda: d, id_categoria: obligacion.id_categoria });
  }
  return salida;
}

export function sugerenciasPara(e: EntradaSugerencias): Sugerencia[] {
  if (e.categorias.length === 0) return [];
  const ids = new Set(e.categorias.map((c) => c.id_categoria));
  const principal = e.categorias[0].id_categoria;
  const diasAviso = e.diasAviso ?? 15;
  const salida: Sugerencia[] = [];
  const usados = new Set<string>();

  // 1. Por pagar.
  const porPagar = deudasDeCategorias(e, ids)
    .map((x) => ({ ...x, dias: x.deuda.fecha_vencimiento ? diasEntre(e.hoy, x.deuda.fecha_vencimiento) : 999 }))
    .filter((x) => x.dias <= diasAviso)
    .sort((a, b) => a.dias - b.dias);
  for (const { deuda, id_categoria, dias } of porPagar) {
    const titulo = deuda.id_prestamo ? `${deuda.persona} · cuota ${deuda.nro_cuota ?? ''}`.trim() : deuda.persona;
    salida.push({
      id: `pagar-${deuda.id_deuda}`,
      tipo: 'pagar',
      titulo,
      detalle: `${formatoMonto(deuda.monto_pendiente)} · ${textoVence(dias)}`,
      id_categoria,
      descripcion: titulo,
      monto: deuda.monto_pendiente,
      id_deuda: deuda.id_deuda,
      urgencia: dias < 0 ? 'vencido' : dias <= 7 ? 'pronto' : undefined,
    });
    usados.add(normalizar(titulo));
  }

  // 2. Trabajadores (categorías de personal).
  const personal = e.categorias.find((c) => c.grupo === 'personal');
  if (personal) {
    for (const t of e.trabajadores.filter((w) => w.activo)) {
      salida.push({
        id: `trabajador-${t.id_trabajador}`,
        tipo: 'trabajador',
        titulo: t.nombre,
        detalle: t.sueldo_base ? `${t.cargo || 'Trabajador'} · base ${formatoMonto(t.sueldo_base)}` : t.cargo || 'Trabajador',
        id_categoria: personal.id_categoria,
        descripcion: `${personal.nombre}: ${t.nombre}`,
        monto: t.sueldo_base || undefined,
        id_trabajador: t.id_trabajador,
      });
    }
  }

  // 3. Lo que ya se pagó: agrupado por descripción, con el último monto y la última fecha.
  const historia = new Map<string, { descripcion: string; monto: number; fecha: string; veces: number; id_categoria: string }>();
  for (const t of e.transacciones) {
    if (t.tipo !== 'gasto' || t.eliminado || !ids.has(t.id_categoria) || !t.descripcion.trim()) continue;
    const clave = normalizar(t.descripcion);
    const previo = historia.get(clave);
    if (!previo) historia.set(clave, { descripcion: t.descripcion.trim(), monto: t.monto, fecha: t.fecha, veces: 1, id_categoria: t.id_categoria });
    else {
      previo.veces += 1;
      // Manda la última vez: monto, fecha y también cómo se escribió.
      if (t.fecha >= previo.fecha) Object.assign(previo, { descripcion: t.descripcion.trim(), monto: t.monto, fecha: t.fecha, id_categoria: t.id_categoria });
    }
  }
  const frecuentes = Array.from(historia.entries())
    .filter(([clave]) => !usados.has(clave))
    .sort((a, b) => b[1].veces - a[1].veces || b[1].fecha.localeCompare(a[1].fecha));
  for (const [clave, h] of frecuentes.slice(0, 5)) {
    const [, mm, dd] = h.fecha.split('-');
    salida.push({
      id: `repetir-${clave}`,
      tipo: 'repetir',
      titulo: h.descripcion,
      detalle: `Última vez ${formatoMonto(h.monto)} · ${dd}/${mm}`,
      id_categoria: h.id_categoria,
      descripcion: h.descripcion,
      monto: h.monto,
    });
    usados.add(clave);
  }

  // 4. Plantillas: rellenan lo que falta, sin monto.
  for (const c of e.categorias) {
    for (const nombre of PLANTILLAS[normalizar(c.nombre)] ?? []) {
      const clave = normalizar(nombre);
      if (usados.has(clave)) continue;
      usados.add(clave);
      salida.push({ id: `plantilla-${c.id_categoria}-${clave}`, tipo: 'plantilla', titulo: nombre, detalle: c.nombre, id_categoria: c.id_categoria, descripcion: nombre });
    }
  }

  void principal;
  return salida.slice(0, e.maximo ?? 10);
}

/** Lo que se debe y vence pronto (o ya venció), para la franja "Por pagar" del inicio. */
export function porPagarPronto(deudas: Deuda[], hoy: string, dias = 7): Array<{ deuda: Deuda; dias: number }> {
  return deudas
    .filter((d) => d.tipo === 'debo' && d.estado !== 'pagada' && d.monto_pendiente > 0 && !d.eliminado && d.fecha_vencimiento)
    .map((deuda) => ({ deuda, dias: diasEntre(hoy, deuda.fecha_vencimiento) }))
    .filter((x) => x.dias <= dias)
    .sort((a, b) => a.dias - b.dias);
}
