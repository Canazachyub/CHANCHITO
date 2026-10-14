import { describe, expect, it } from 'vitest';
import type { Categoria, Cuenta, Deuda, Trabajador, Transaccion } from './types';
import {
  construirTablero,
  explicarFormula,
  formulaEnEspanol,
  letraColumna,
  referenciasExternas,
  type EntradaTablero,
  type Hoja,
  type Tablero,
} from './tablero';

// ---------------------------------------------------------------------------------------------
// Mini evaluador de fórmulas: recalcula cada celda como lo haría Excel y la compara con el valor
// que calculó el modelo. Si alguien cambia una fórmula sin cambiar el valor (o al revés), falla.

const HOY = '2026-10-14';

function columnaIndice(letras: string): number {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function valorCelda(tablero: Tablero, hoja: string, col: number, fila: number): number | string | null {
  const h = tablero.hojas.find((x) => x.id === hoja)!;
  if (fila === 1) return h.columnas[col];
  const f = h.filas[fila - 2];
  if (!f) return null;
  if (col === 0) return f.etiqueta;
  const c = f.celdas[col - 1];
  if (!c) return null;
  // Las fechas se evalúan como número de días, igual que en Excel.
  if (c.fmt === 'fecha' && typeof c.v === 'string') return Date.parse(c.v) / 86400000;
  return c.v;
}

function evaluar(tablero: Tablero, hojaActual: string, formula: string): unknown {
  const rango = (hoja: string, a: string, b: string) => {
    const [, ca, fa] = a.match(/([A-Z]+)(\d+)/)!;
    const [, cb, fb] = b.match(/([A-Z]+)(\d+)/)!;
    const vals: Array<number | string | null> = [];
    for (let fi = Number(fa); fi <= Number(fb); fi++)
      for (let co = columnaIndice(ca); co <= columnaIndice(cb); co++) vals.push(valorCelda(tablero, hoja, co, fi));
    return vals;
  };
  let js = formula
    .replace(/"([^"]*)"/g, (_, s) => JSON.stringify(s))
    // Rangos y celdas en UNA pasada: con dos, la segunda volvía a reemplazar lo ya convertido.
    .replace(/\b(?:([A-Za-z]+)!)?([A-Z]{1,2}\d+)(?::([A-Z]{1,2}\d+))?\b/g, (_, h, a, b) => {
      const hoja = JSON.stringify(h ?? hojaActual);
      if (b) return `R(${hoja},"${a}","${b}")`;
      const [, c, f] = a.match(/([A-Z]+)(\d+)/)!;
      return `V(${hoja},${columnaIndice(c)},${f})`;
    })
    .replace(/(?<![<>=!])=(?!=)/g, '===');
  js = js.replace(/\bSUMIF\(/g, 'SUMIF(').replace(/\bTODAY\(\)/g, `(${Date.parse(HOY) / 86400000})`);
  const num = (x: unknown) => (typeof x === 'number' ? x : 0);
  const fns = {
    R: rango,
    V: (h: string, c: number, f: number) => valorCelda(tablero, h, c, f),
    SUM: (...xs: unknown[]) => xs.flat().reduce<number>((s, x) => s + num(x), 0),
    AVERAGE: (...xs: unknown[]) => {
      const n = xs.flat().filter((x) => typeof x === 'number') as number[];
      return n.reduce((s, x) => s + x, 0) / n.length;
    },
    MAX: (...xs: number[]) => Math.max(...xs),
    IF: (c: boolean, a: unknown, b: unknown) => (c ? a : b),
    SUMIF: (crit: unknown[], valor: string, suma: unknown[]) =>
      crit.reduce<number>((s, x, i) => (x === valor ? s + num(suma[i]) : s), 0),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...Object.keys(fns), `return (${js});`)(...Object.values(fns));
}

function verificarFormulas(tablero: Tablero) {
  let revisadas = 0;
  for (const hoja of tablero.hojas) {
    hoja.filas.forEach((fila, i) => {
      fila.celdas.forEach((celda, col) => {
        if (!celda.f) return;
        const calculado = evaluar(tablero, hoja.id, celda.f);
        const esperado = celda.v === null ? '' : celda.v;
        const donde = `${hoja.id}!${letraColumna(col + 1)}${i + 2} =${celda.f}`;
        if (typeof esperado === 'number') expect(calculado as number, donde).toBeCloseTo(esperado, 6);
        else expect(calculado, donde).toBe(esperado);
        revisadas++;
      });
    });
  }
  return revisadas;
}

// ---------------------------------------------------------------------------------------------
// Fixtures

let n = 0;
function trx(p: Partial<Transaccion>): Transaccion {
  return {
    id_transaccion: `TRX_${n++}`, id_espacio: 'ESP_TELCOM', id_usuario: 'USR_a', id_cuenta: 'CTA_banco',
    id_categoria: 'CAT_comb', tipo: 'gasto', monto: 100, descripcion: '', fecha: '2026-10-05', hora: '',
    ubicacion: '', notas: '', rev: 1, origen: 'app', eliminado: false, fecha_creacion: '', fecha_modificacion: '',
    sync_status: 'synced', ...p,
  };
}
const cat = (id: string, nombre: string, grupo: string, tipo: 'gasto' | 'ingreso' = 'gasto'): Categoria => ({
  id_categoria: id, id_espacio: 'ESP_TELCOM', nombre, tipo, icono: '', color: '', es_sistema: true, grupo, orden: 0, activo: true,
});
const CATS = [
  cat('CAT_comb', 'Combustible', 'operativos'),
  cat('CAT_sueldo', 'Sueldos y honorarios', 'personal'),
  cat('CAT_essalud', 'EsSalud', 'personal'),
  cat('CAT_igv', 'Impuestos y SUNAT', 'impuestos'),
  cat('CAT_fact', 'Servicios facturados', 'ingresos', 'ingreso'),
];
const cuenta = (id: string, nombre: string, saldo: number): Cuenta =>
  ({ id_cuenta: id, id_espacio: 'ESP_TELCOM', nombre, saldo_inicial: saldo, activo: true } as Cuenta);
const trabajador = (id: string, nombre: string, sueldo: number): Trabajador => ({
  id_trabajador: id, id_espacio: 'ESP_TELCOM', nombre, documento: '', tipo_vinculo: 'planilla', cargo: '', proyecto: '',
  sueldo_base: sueldo, pension: '', fecha_ingreso: '', fecha_fin: '', id_usuario: '', activo: true, notas: '',
  fecha_creacion: '', fecha_modificacion: '',
});
const deuda = (p: Partial<Deuda>): Deuda => ({
  id_deuda: `DDA_${n++}`, id_espacio: 'ESP_TELCOM', id_usuario: '', tipo: 'debo', persona: 'SUNAT', monto_original: 100,
  monto_pendiente: 100, descripcion: '', fecha_creacion: '', fecha_vencimiento: '2026-10-20', estado: 'pendiente',
  recordatorio: true, notas: '', rev: 1, origen: 'app', eliminado: false, sync_status: 'synced', ...p,
});

function entradaTelcom(): EntradaTablero {
  return {
    categorias: CATS,
    cuentas: [cuenta('CTA_banco', 'Banco', 10000), cuenta('CTA_caja', 'Caja chica', 500)],
    trabajadores: [trabajador('TRB_1', 'Rosa', 3000), trabajador('TRB_2', 'Jorge', 1500)],
    deudas: [
      deuda({ tipo: 'debo', persona: 'SUNAT', monto_pendiente: 363.5, fecha_vencimiento: '2026-10-31' }),
      deuda({ tipo: 'debo', persona: 'Sueldo Rosa', monto_pendiente: 3000, id_trabajador: 'TRB_1' }),
      deuda({ tipo: 'me_deben', persona: 'Jorge', monto_pendiente: 300, id_trabajador: 'TRB_2', fecha_vencimiento: '2026-10-10' }),
      deuda({ tipo: 'me_deben', persona: 'Cliente', monto_pendiente: 5000, fecha_vencimiento: '' }),
      deuda({ tipo: 'debo', persona: 'Ya pagada', estado: 'pagada', monto_pendiente: 0 }),
    ],
    transacciones: [
      trx({ tipo: 'ingreso', id_categoria: 'CAT_fact', monto: 12000, fecha: '2026-10-03' }),
      trx({ tipo: 'ingreso', id_categoria: 'CAT_fact', monto: 9000, fecha: '2026-09-03' }),
      trx({ id_categoria: 'CAT_sueldo', monto: 1500, id_trabajador: 'TRB_2', fecha: '2026-10-30' }),
      trx({ id_categoria: 'CAT_sueldo', monto: 3000, id_trabajador: 'TRB_1', fecha: '2026-09-30' }),
      trx({ id_categoria: 'CAT_essalud', monto: 405, fecha: '2026-10-15' }),
      trx({ id_categoria: 'CAT_comb', monto: 250, fecha: '2026-10-07', id_cuenta: 'CTA_caja' }),
      trx({ id_categoria: 'CAT_comb', monto: 180, fecha: '2026-08-07', id_cuenta: 'CTA_caja' }),
      trx({ id_categoria: 'CAT_igv', monto: 900, fecha: '2026-10-14' }),
      trx({ id_categoria: 'CAT_comb', monto: 99, fecha: '2025-09-30' }), // fuera de la ventana de 12 meses
    ],
    mes: 10,
    anio: 2026,
    hoy: HOY,
  };
}

const hoja = (t: Tablero, id: string): Hoja => t.hojas.find((h) => h.id === id)!;
const valorDe = (h: Hoja, etiqueta: string, col: number) => h.filas.find((f) => f.etiqueta === etiqueta)!.celdas[col].v;

// ---------------------------------------------------------------------------------------------

describe('construirTablero', () => {
  it('cada fórmula del libro recalcula exactamente su valor', () => {
    const t = construirTablero(entradaTelcom());
    expect(verificarFormulas(t)).toBeGreaterThan(80);
  });

  it('arma Resultados con 12 meses, total y resultado acumulado', () => {
    const r = hoja(construirTablero(entradaTelcom()), 'Resultados');
    expect(r.columnas).toHaveLength(14);
    expect(r.columnas[12]).toBe('Oct 26');
    expect(valorDe(r, 'Total ingresos', 11)).toBe(12000);
    expect(valorDe(r, 'Total gastos', 11)).toBe(1500 + 405 + 250 + 900);
    expect(valorDe(r, 'Personal', 11)).toBe(1905);
    expect(valorDe(r, 'Total gastos', 12)).toBe(1500 + 405 + 250 + 900 + 3000 + 180);
    expect(valorDe(r, 'Resultado acumulado', 11)).toBe(21000 - 6235);
  });

  it('la planilla cuadra contra Resultados gracias a la fila de personal sin trabajador', () => {
    const p = hoja(construirTablero(entradaTelcom()), 'Planilla');
    expect(valorDe(p, 'Rosa', 2)).toBe(0);
    expect(valorDe(p, 'Rosa', 3)).toBe(3000); // pendiente del sueldo
    expect(valorDe(p, 'Jorge', 4)).toBe(300); // adelanto por descontar
    expect(valorDe(p, 'Jorge', 5)).toBe(0); // ya cobró todo: no hay neto a pagar
    expect(valorDe(p, 'Personal sin trabajador asignado', 2)).toBe(405);
    expect(valorDe(p, 'Diferencia (debe ser 0)', 2)).toBe(0);
  });

  it('caja parte del saldo al inicio del mes y cuadra con Resultados', () => {
    const c = hoja(construirTablero(entradaTelcom()), 'Caja');
    expect(valorDe(c, 'Caja chica', 0)).toBe(500 - 180);
    expect(valorDe(c, 'Caja chica', 3)).toBe(500 - 180 - 250);
    expect(valorDe(c, 'Diferencia (debe ser 0)', 1)).toBe(0);
    expect(valorDe(c, 'Diferencia (debe ser 0)', 2)).toBe(0);
  });

  it('el resumen lee de las otras hojas y calcula posición neta y meses de caja', () => {
    const t = construirTablero(entradaTelcom());
    const r = hoja(t, 'Resumen');
    const caja = valorDe(hoja(t, 'Caja'), 'Total', 3) as number;
    expect(valorDe(r, 'Caja disponible', 0)).toBe(caja);
    expect(valorDe(r, 'Por pagar', 0)).toBe(3363.5);
    expect(valorDe(r, 'Por cobrar', 0)).toBe(5300);
    expect(valorDe(r, 'Posición neta', 0)).toBeCloseTo(caja + 5300 - 3363.5);
    expect(r.filas.find((f) => f.etiqueta === 'Caja disponible')!.celdas[0].f).toBe('Caja!E4');
  });

  it('Familia (sin grupos ni trabajadores) agrupa por categoría y omite Planilla', () => {
    const familia: EntradaTablero = {
      ...entradaTelcom(),
      categorias: [cat('CAT_x', 'Comida', ''), cat('CAT_y', 'Sueldo', '', 'ingreso')],
      trabajadores: [],
      deudas: [],
      transacciones: [trx({ id_categoria: 'CAT_x', monto: 80 }), trx({ id_categoria: 'CAT_y', tipo: 'ingreso', monto: 3000 })],
    };
    const t = construirTablero(familia);
    expect(t.hojas.map((h) => h.id)).toEqual(['Resumen', 'Resultados', 'Caja', 'PorCobrarPagar']);
    expect(hoja(t, 'Resultados').filas.some((f) => f.etiqueta === 'Comida')).toBe(true);
    verificarFormulas(t);
  });

  it('un libro vacío no genera rangos inválidos', () => {
    const t = construirTablero({ ...entradaTelcom(), transacciones: [], deudas: [], trabajadores: [], cuentas: [] });
    expect(verificarFormulas(t)).toBeGreaterThan(0);
    // Totales sobre listas vacías quedan como 0 literal, nunca SUM(B3:B2).
    const formulas = t.hojas.flatMap((h) => h.filas.flatMap((f) => f.celdas.map((c) => c.f ?? '')));
    for (const f of formulas) {
      for (const [, , desde, , hasta] of f.matchAll(/([A-Z]+)(\d+):([A-Z]+)(\d+)/g)) {
        expect(Number(hasta)).toBeGreaterThanOrEqual(Number(desde));
      }
    }
  });
});

describe('formulaEnEspanol y referencias', () => {
  it('traduce funciones y separadores sin tocar los textos', () => {
    expect(formulaEnEspanol('SUMIF(B2:B5,"Por pagar",F2:F5)')).toBe('=SUMAR.SI(B2:B5;"Por pagar";F2:F5)');
    expect(formulaEnEspanol('IF(B3=0,"",B5/B3)')).toBe('=SI(B3=0;"";B5/B3)');
    expect(formulaEnEspanol('AVERAGE(Resultados!K12:M12)')).toBe('=PROMEDIO(Resultados!K12:M12)');
  });

  it('extrae las referencias a otras hojas', () => {
    expect(referenciasExternas('Caja!E4+PorCobrarPagar!F7-B3')).toEqual([
      { hoja: 'Caja', columna: 4, fila: 4 },
      { hoja: 'PorCobrarPagar', columna: 5, fila: 7 },
    ]);
  });
});

describe('explicarFormula', () => {
  const t = construirTablero(entradaTelcom());
  const textoDe = (piezas: ReturnType<typeof explicarFormula>) =>
    piezas.map((p) => (p.tipo === 'texto' ? p.texto : `[${p.etiqueta}]`)).join('');

  it('posición neta se lee con los nombres de las filas', () => {
    expect(textoDe(explicarFormula(t, 'Resumen', 'B3+B4-B5'))).toBe('[Caja disponible] + [Por cobrar] − [Por pagar]');
  });

  it('las referencias a otra hoja dicen de qué hoja y columna vienen, con su valor', () => {
    const [p] = explicarFormula(t, 'Resumen', 'Caja!E4');
    expect(p).toMatchObject({ tipo: 'ref', hoja: 'Caja', etiqueta: 'Total · Saldo final (Caja y cuentas)' });
    expect(typeof (p as { valor: unknown }).valor).toBe('number');
  });

  it('traduce MAX, IF, SUMIF, AVERAGE y rangos largos', () => {
    expect(textoDe(explicarFormula(t, 'Planilla', 'MAX(0,C2-D2)'))).toBe('[Rosa · Sueldo base] − [Rosa · Pagado en el mes] (si da negativo, 0)');
    expect(textoDe(explicarFormula(t, 'Resumen', 'IF(B8=0,"",B10/B8)'))).toBe('[Resultado del mes] ÷ [Ingresos del mes]');
    expect(textoDe(explicarFormula(t, 'PorCobrarPagar', 'SUMIF(B2:B5,"Por pagar",F2:F5)'))).toBe('Suma de «Pendiente» donde «Tipo» es “Por pagar”');
    expect(textoDe(explicarFormula(t, 'Resultados', 'SUM(B3:M3)'))).toContain('de Nov 25 a Oct 26');
    expect(textoDe(explicarFormula(t, 'Resumen', 'AVERAGE(Resultados!K9:M9)'))).toMatch(/^Promedio de /);
  });

  it('todas las fórmulas del libro se pueden explicar sin romper', () => {
    for (const h of t.hojas)
      for (const fila of h.filas)
        for (const c of fila.celdas) if (c.f) expect(explicarFormula(t, h.id, c.f).length).toBeGreaterThan(0);
  });
});
