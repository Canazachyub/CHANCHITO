/**
 * TCEA aproximada de un préstamo — lógica PURA.
 *
 * La TCEA es la tasa anual que iguala lo recibido con todo lo que se paga (intereses, seguro y
 * comisiones incluidos). Se obtiene con la TIR mensual `i` que cumple
 *   monto = Σ cuota_k / (1 + i)^k
 * y se anualiza: TCEA = (1 + i)^12 − 1. Es aproximada: supone cuotas a intervalos mensuales exactos.
 */

/** Valor presente de las cuotas a la tasa mensual `i`. */
function valorPresente(cuotas: number[], i: number): number {
  let vp = 0;
  for (let k = 0; k < cuotas.length; k++) vp += cuotas[k] / Math.pow(1 + i, k + 1);
  return vp;
}

/**
 * TIR mensual (fracción) por bisección. Devuelve `null` si no se puede calcular
 * (monto <= 0, sin cuotas o la suma de cuotas no alcanza el monto).
 */
export function tirMensual(monto: number, cuotas: number[]): number | null {
  if (!(monto > 0) || cuotas.length === 0 || cuotas.some((c) => !Number.isFinite(c) || c < 0)) return null;
  const total = cuotas.reduce((s, c) => s + c, 0);
  if (total < monto - 1e-9) return null;
  if (Math.abs(total - monto) < 1e-9) return 0;
  // valorPresente decrece con i: buscamos la raíz de vp(i) − monto en [0, alto].
  let bajo = 0;
  let alto = 1;
  while (valorPresente(cuotas, alto) > monto && alto < 1e6) alto *= 2;
  for (let it = 0; it < 200; it++) {
    const medio = (bajo + alto) / 2;
    if (valorPresente(cuotas, medio) > monto) bajo = medio;
    else alto = medio;
  }
  return (bajo + alto) / 2;
}

/** TCEA en porcentaje (p. ej. 21.4) o `null` si no se puede calcular. */
export function tceaAproximada(monto: number, cuotas: number[]): number | null {
  const i = tirMensual(monto, cuotas);
  if (i === null) return null;
  return (Math.pow(1 + i, 12) - 1) * 100;
}
