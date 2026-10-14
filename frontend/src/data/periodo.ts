/**
 * Aritmética de períodos del inicio móvil (DESIGN § 8.1): Día · Semana · Mes · Año.
 * Funciones puras y sin zona horaria: trabajan con fechas locales y devuelven 'yyyy-MM-dd',
 * el mismo formato en que se guarda Transaccion.fecha, así que comparar strings basta.
 * La semana empieza el lunes.
 */

export type TipoPeriodo = 'dia' | 'semana' | 'mes' | 'anio';

export interface RangoPeriodo {
  /** Primer día incluido, 'yyyy-MM-dd'. */
  desde: string;
  /** Último día incluido, 'yyyy-MM-dd'. */
  hasta: string;
  /** Texto para "Saldo de …": 'octubre', '12–18 oct', '2026'. */
  etiqueta: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

/** Fecha local → 'yyyy-MM-dd' (no usa toISOString: en UTC-5 daría el día siguiente de noche). */
export function fechaYmd(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** 'yyyy-MM-dd' → Date local a medianoche. */
export function parseYmd(ymd: string): Date {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(a, (m ?? 1) - 1, d ?? 1);
}

function ultimoDiaDelMes(anio: number, mes0: number): number {
  return new Date(anio, mes0 + 1, 0).getDate();
}

function corto(d: Date): string {
  return `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;
}

/** Rango [desde, hasta] del período que contiene a `ancla`. `hoy` solo decide si la etiqueta del mes lleva año. */
export function rangoDe(tipo: TipoPeriodo, ancla: Date, hoy: Date = new Date()): RangoPeriodo {
  const a = new Date(ancla.getFullYear(), ancla.getMonth(), ancla.getDate());

  if (tipo === 'dia') {
    const ymd = fechaYmd(a);
    return { desde: ymd, hasta: ymd, etiqueta: corto(a) };
  }

  if (tipo === 'semana') {
    const desdeFecha = new Date(a.getFullYear(), a.getMonth(), a.getDate() - ((a.getDay() + 6) % 7));
    const hastaFecha = new Date(desdeFecha.getFullYear(), desdeFecha.getMonth(), desdeFecha.getDate() + 6);
    const etiqueta =
      desdeFecha.getMonth() === hastaFecha.getMonth()
        ? `${desdeFecha.getDate()}–${corto(hastaFecha)}`
        : `${corto(desdeFecha)} – ${corto(hastaFecha)}`;
    return { desde: fechaYmd(desdeFecha), hasta: fechaYmd(hastaFecha), etiqueta };
  }

  if (tipo === 'mes') {
    const anio = a.getFullYear();
    const mes0 = a.getMonth();
    const desde = `${anio}-${dos(mes0 + 1)}-01`;
    const hasta = `${anio}-${dos(mes0 + 1)}-${dos(ultimoDiaDelMes(anio, mes0))}`;
    const etiqueta = anio === hoy.getFullYear() ? MESES[mes0] : `${MESES[mes0]} ${anio}`;
    return { desde, hasta, etiqueta };
  }

  const anio = a.getFullYear();
  return { desde: `${anio}-01-01`, hasta: `${anio}-12-31`, etiqueta: String(anio) };
}

/** Desplaza el ancla `pasos` períodos (negativo = atrás). Mes/año recortan el día (31 ene + 1 mes = 28/29 feb). */
export function mover(tipo: TipoPeriodo, ancla: Date, pasos: number): Date {
  const y = ancla.getFullYear();
  const m = ancla.getMonth();
  const d = ancla.getDate();
  if (tipo === 'dia') return new Date(y, m, d + pasos);
  if (tipo === 'semana') return new Date(y, m, d + pasos * 7);
  if (tipo === 'mes') {
    const destino = new Date(y, m + pasos, 1);
    return new Date(destino.getFullYear(), destino.getMonth(), Math.min(d, ultimoDiaDelMes(destino.getFullYear(), destino.getMonth())));
  }
  const anio = y + pasos;
  return new Date(anio, m, Math.min(d, ultimoDiaDelMes(anio, m)));
}

/** ¿La fecha 'yyyy-MM-dd' cae dentro del rango (inclusive)? */
export function enRango(fecha: string, r: Pick<RangoPeriodo, 'desde' | 'hasta'>): boolean {
  return fecha >= r.desde && fecha <= r.hasta;
}

/** Más usadas primero (según `uso`); a igual uso conserva el orden original (el `orden` de la categoría). */
export function ordenarPorUso<T extends { id_categoria: string }>(categorias: T[], uso: Record<string, number> | undefined): T[] {
  return categorias
    .map((c, i) => ({ c, i, n: uso?.[c.id_categoria] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.c);
}
