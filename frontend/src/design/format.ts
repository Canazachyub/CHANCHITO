/**
 * Helpers de formato compartidos por toda la UI. Único lugar donde se
 * instancia Intl.NumberFormat para moneda: si se crea uno por componente,
 * cada re-render paga el costo de parsear el locale de nuevo.
 */

const formateadorMoneda = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
});

const formateadorMonedaSigno = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  signDisplay: 'always',
});

export function formatMoneda(monto: number): string {
  return formateadorMoneda.format(monto);
}

/** Con signo explícito (+/-), para filas de transacción. */
export function formatMontoConSigno(monto: number, tipo: 'gasto' | 'ingreso'): string {
  const valor = tipo === 'gasto' ? -Math.abs(monto) : Math.abs(monto);
  return formateadorMonedaSigno.format(valor);
}

const formateadorFechaCorta = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
});

const formateadorFechaLarga = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Parsea 'yyyy-MM-dd' como fecha local, evitando el corrimiento de zona
 * horaria que da `new Date('yyyy-MM-dd')` (lo interpreta como UTC). */
function parseFechaLocal(fechaIso: string): Date {
  const [anio, mes, dia] = fechaIso.split('-').map(Number);
  return new Date(anio, (mes ?? 1) - 1, dia ?? 1);
}

export function formatFechaCorta(fechaIso: string): string {
  return formateadorFechaCorta.format(parseFechaLocal(fechaIso));
}

export function formatFechaLarga(fechaIso: string): string {
  return formateadorFechaLarga.format(parseFechaLocal(fechaIso));
}

export function nombreMes(mes: number): string {
  return NOMBRES_MES[mes - 1] ?? '';
}

export function nombreMesCorto(mes: number): string {
  return nombreMes(mes).slice(0, 3);
}

/** Días enteros hasta la fecha (negativo si ya pasó). Espejo en el
 * cliente de `diasHastaVencimiento` del backend, solo para pintar la UI. */
export function diasHasta(fechaIso: string, hoy: Date = new Date()): number {
  const objetivo = parseFechaLocal(fechaIso);
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const msPorDia = 1000 * 60 * 60 * 24;
  return Math.round((objetivo.getTime() - inicioHoy.getTime()) / msPorDia);
}

export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
