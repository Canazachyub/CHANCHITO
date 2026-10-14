import { describe, expect, it } from 'vitest';
import { evaluar, montoDe, pulsar, tieneOperacion } from './calculadora';

describe('evaluar', () => {
  it('número simple, con punto o coma', () => {
    expect(evaluar('12.5')).toEqual({ ok: true, valor: 12.5 });
    expect(evaluar('12,5')).toEqual({ ok: true, valor: 12.5 });
  });

  it('3 × 12.5 = 37.5', () => {
    expect(montoDe('3×12.5')).toBe(37.5);
    expect(montoDe('3 x 12,5')).toBe(37.5);
  });

  it('precedencia: × y ÷ antes que + y −', () => {
    expect(montoDe('2+3×4')).toBe(14);
    expect(montoDe('10−6÷2')).toBe(7);
    expect(montoDe('2×3+4×5')).toBe(26);
  });

  it('asociatividad por la izquierda', () => {
    expect(montoDe('10−3−2')).toBe(5);
    expect(montoDe('100÷5÷2')).toBe(10);
  });

  it('acepta signos ASCII', () => {
    expect(montoDe('6*7-2/2+1')).toBe(42);
  });

  it('redondea a 2 decimales', () => {
    expect(montoDe('10÷3')).toBe(3.33);
    expect(montoDe('2÷3')).toBe(0.67);
    expect(montoDe('0.1+0.2')).toBe(0.3);
    expect(montoDe('1.005×1')).toBe(1.01);
  });

  it('división por cero es error', () => {
    const r = evaluar('5÷0');
    expect(r.ok).toBe(false);
    expect(montoDe('8÷(0)')).toBeNull();
    expect(montoDe('3+4÷0')).toBeNull();
  });

  it('expresiones inválidas', () => {
    expect(evaluar('').ok).toBe(false);
    expect(evaluar('3+').ok).toBe(false);
    expect(evaluar('×3').ok).toBe(false);
    expect(evaluar('1.2.3').ok).toBe(false);
    expect(evaluar('.').ok).toBe(false);
    expect(evaluar('2abc').ok).toBe(false);
    expect(evaluar('alert(1)').ok).toBe(false);
  });

  it('resultado negativo se devuelve (la validación de monto > 0 es de la hoja)', () => {
    expect(montoDe('3−5')).toBe(-2);
  });
});

describe('pulsar', () => {
  const teclear = (...teclas: string[]) => teclas.reduce((e, t) => pulsar(e, t), '');

  it('arma 3×12.5=', () => {
    expect(teclear('3', '×', '1', '2', '.', '5')).toBe('3×12.5');
    expect(teclear('3', '×', '1', '2', '.', '5', '=')).toBe('37.5');
  });

  it('no permite dos puntos en el mismo número, sí en números distintos', () => {
    expect(teclear('1', '.', '5', '.')).toBe('1.5');
    expect(teclear('1', '.', '5', '+', '2', '.', '5')).toBe('1.5+2.5');
  });

  it('punto al inicio de un número añade el cero', () => {
    expect(teclear('.')).toBe('0.');
    expect(teclear('5', '+', '.')).toBe('5+0.');
  });

  it('operador repetido reemplaza al anterior; no se empieza con operador', () => {
    expect(teclear('+')).toBe('');
    expect(teclear('5', '+', '×')).toBe('5×');
    expect(teclear('5', '.', '+')).toBe('5+');
  });

  it('sin ceros a la izquierda', () => {
    expect(teclear('0', '5')).toBe('5');
    expect(teclear('0', '0')).toBe('0');
    expect(teclear('2', '0')).toBe('20');
  });

  it('borrar y limpiar', () => {
    expect(teclear('1', '2', '⌫')).toBe('1');
    expect(teclear('⌫')).toBe('');
    expect(teclear('1', '+', '2', 'C')).toBe('');
  });

  it('= con expresión inválida la deja igual; con división por cero también', () => {
    expect(teclear('5', '+', '=')).toBe('5+');
    expect(teclear('5', '÷', '0', '=')).toBe('5÷0');
  });

  it('tieneOperacion', () => {
    expect(tieneOperacion('12.5')).toBe(false);
    expect(tieneOperacion('3×2')).toBe(true);
  });
});
