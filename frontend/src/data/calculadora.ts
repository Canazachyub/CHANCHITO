/**
 * Calculadora del teclado de la hoja de registro ("3 pasajes de 12.50" se anota tal cual).
 * Evaluador propio —sin eval ni Function— de + − × ÷ con precedencia, coma o punto decimal,
 * resultado redondeado a 2 decimales. Todo puro.
 */

export type ResultadoCalculo = { ok: true; valor: number } | { ok: false; error: string };

const OPERADORES = ['+', '−', '×', '÷'];
const SEPARADOR = /[+−×÷]/;

/** Unifica los signos que puede traer el texto (teclado físico, pegado) a los del teclado. */
function normalizar(expr: string): string {
  return expr
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[*xX]/g, '×')
    .replace(/[/]/g, '÷')
    .replace(/[-–]/g, '−');
}

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function evaluar(expr: string): ResultadoCalculo {
  const s = normalizar(expr);
  if (s === '') return { ok: false, error: 'Escribe un monto' };

  let i = 0;
  let divisionPorCero = false;

  const numero = (): number | null => {
    const inicio = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const texto = s.slice(inicio, i);
    if (texto === '' || texto === '.' || (texto.match(/\./g) ?? []).length > 1) return null;
    return Number(texto);
  };

  const factor = (): number | null => {
    if (s[i] === '−') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    return numero();
  };

  const termino = (): number | null => {
    let acc = factor();
    while (acc !== null && (s[i] === '×' || s[i] === '÷')) {
      const op = s[i++];
      const der = factor();
      if (der === null) return null;
      if (op === '×') acc *= der;
      else if (der === 0) divisionPorCero = true;
      else acc /= der;
    }
    return acc;
  };

  const suma = (): number | null => {
    let acc = termino();
    while (acc !== null && (s[i] === '+' || s[i] === '−')) {
      const op = s[i++];
      const der = termino();
      if (der === null) return null;
      acc = op === '+' ? acc + der : acc - der;
    }
    return acc;
  };

  const v = suma();
  if (divisionPorCero) return { ok: false, error: 'No se puede dividir entre cero' };
  if (v === null || i < s.length) return { ok: false, error: 'Operación incompleta' };
  if (!Number.isFinite(v)) return { ok: false, error: 'Resultado fuera de rango' };
  return { ok: true, valor: redondear2(v) };
}

/** Monto final de la expresión, o null si no se puede calcular. */
export function montoDe(expr: string): number | null {
  const r = evaluar(expr);
  return r.ok ? r.valor : null;
}

/** Aplica una tecla ('0'-'9', '.', '+', '−', '×', '÷', '⌫', 'C', '=') a la expresión y devuelve la nueva. */
export function pulsar(expr: string, tecla: string): string {
  const ultimo = expr.slice(-1);
  const esOperador = (c: string) => OPERADORES.includes(c);
  const segmento = expr.split(SEPARADOR).pop() ?? '';

  if (/^[0-9]$/.test(tecla)) {
    // Evita ceros a la izquierda: "0" + "5" → "5".
    if (segmento === '0') return expr.slice(0, -1) + tecla;
    return expr + tecla;
  }
  if (tecla === '.' || tecla === ',') {
    if (segmento.includes('.')) return expr;
    return segmento === '' ? `${expr}0.` : `${expr}.`;
  }
  if (esOperador(tecla)) {
    if (expr === '') return expr;
    if (esOperador(ultimo) || ultimo === '.') return expr.slice(0, -1) + tecla;
    return expr + tecla;
  }
  if (tecla === '⌫') return expr.slice(0, -1);
  if (tecla === 'C') return '';
  if (tecla === '=') {
    const r = evaluar(expr);
    return r.ok ? String(r.valor) : expr;
  }
  return expr;
}

/** ¿Hay una operación pendiente de resolver (algún operador en la expresión)? */
export function tieneOperacion(expr: string): boolean {
  return SEPARADOR.test(expr);
}
