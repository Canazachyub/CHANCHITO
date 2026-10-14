/**
 * Tablero de hojas conectadas — lógica PURA.
 *
 * Arma un libro tipo Excel donde cada total es una fórmula sobre otras celdas, y las hojas se
 * referencian entre sí (el Resumen lee de Caja, Planilla y Resultados; Planilla y Caja tienen
 * filas de control contra Resultados). El mismo modelo alimenta la vista en la app y la
 * exportación a .xlsx, así que lo que el usuario ve en pantalla es literalmente la fórmula que
 * tendrá en Excel.
 *
 * Las fórmulas se guardan en la sintaxis interna de Excel (inglés, coma): es lo que un .xlsx
 * almacena y Excel muestra traducido al idioma del usuario. `formulaEnEspanol` la traduce para la
 * pantalla. Los valores se calculan acá en JS y los tests verifican que cuadran con la fórmula.
 *
 * Fila 1 de cada hoja = encabezados. `filas[i]` vive en la fila i + 2. Columna A = etiqueta.
 */
import type { Categoria, Cuenta, Deuda, Trabajador, Transaccion } from './types';
import { mesAnterior, perteneceAMes } from './analisis';

export type Formato = 'moneda' | 'pct' | 'texto' | 'entero' | 'fecha' | 'meses';

/**
 * Qué dato real corrige una celda editable. La vista llama con esto a las mismas funciones de
 * data/api.ts que usa el resto de la app, así la corrección se ve igual en todas partes.
 */
export type Edicion =
  | { entidad: 'trabajador'; id: string; campo: 'sueldo_base' }
  | { entidad: 'deuda'; id: string; campo: 'monto_pendiente' | 'fecha_vencimiento' }
  /** `base` = neto de los movimientos anteriores al mes: saldo_inicial nuevo = valor − base. */
  | { entidad: 'cuenta'; id: string; campo: 'saldo_inicial'; base: number };

/** Qué movimientos hay detrás de una cifra agregada, para abrirlos y corregirlos uno por uno. */
export interface Detalle {
  mes: number;
  anio: number;
  tipo?: 'gasto' | 'ingreso';
  id_categoria?: string;
  /** Grupo de categorías (Telcom). */
  grupo?: string;
  id_trabajador?: string;
  id_cuenta?: string;
  /** Solo pagos de personal sin trabajador asignado. */
  sin_trabajador?: boolean;
}

export interface Celda {
  /** Valor ya calculado (también se guarda como resultado cacheado en el .xlsx). */
  v: number | string | null;
  /** Fórmula Excel sin el '=' inicial, en sintaxis interna (SUM, IF, coma). */
  f?: string;
  fmt?: Formato;
  editar?: Edicion;
  detalle?: Detalle;
}

export type TipoFila = 'seccion' | 'dato' | 'subtotal' | 'total' | 'control';

export interface FilaHoja {
  etiqueta: string;
  tipo: TipoFila;
  /** Celdas de las columnas B en adelante. */
  celdas: Celda[];
  nota?: string;
}

export type IdHoja = 'Resumen' | 'Resultados' | 'Planilla' | 'Caja' | 'PorCobrarPagar';

export interface Hoja {
  id: IdHoja;
  titulo: string;
  descripcion: string;
  /** Encabezados, incluida la columna A. */
  columnas: string[];
  filas: FilaHoja[];
}

export interface Tablero {
  hojas: Hoja[];
  mes: number;
  anio: number;
}

export interface EntradaTablero {
  transacciones: Transaccion[];
  categorias: Categoria[];
  cuentas: Cuenta[];
  deudas: Deuda[];
  trabajadores: Trabajador[];
  mes: number;
  anio: number;
  /** 'yyyy-MM-dd'. */
  hoy: string;
}

// ---------------------------------------------------------------------------------------------
// Utilidades de direcciones

/** 0 → 'A', 1 → 'B', ... 26 → 'AA'. */
export function letraColumna(indice: number): string {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Fila de Excel de `filas[i]`. */
const filaExcel = (i: number) => i + 2;

/** Dirección de la celda de datos `col` (0 = columna B) en la fila `i`. */
function dir(col: number, i: number): string {
  return `${letraColumna(col + 1)}${filaExcel(i)}`;
}

function ref(hoja: IdHoja, col: number, i: number): string {
  return `${hoja}!${dir(col, i)}`;
}

const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const ETIQUETA_GRUPO: Record<string, string> = {
  operativos: 'Operativos',
  personal: 'Personal',
  activos: 'Activos fijos',
  impuestos: 'Impuestos',
  '': 'Otros',
};

const vacia = (): Celda => ({ v: null });
const texto = (v: string): Celda => ({ v, fmt: 'texto' });

/** Suma de un rango vertical; con rango vacío, la fórmula es 0 en vez de un rango inválido. */
function formulaSuma(col: number, desde: number, hasta: number): string {
  return hasta < desde ? '0' : `SUM(${dir(col, desde)}:${dir(col, hasta)})`;
}

// ---------------------------------------------------------------------------------------------
// Hoja Resultados: 12 meses + total.

interface FilasClave {
  totalIngresos: number;
  totalGastos: number;
  resultado: number;
  personal: number | null;
}

function hojaResultados(e: EntradaTablero): { hoja: Hoja; filas: FilasClave; colMes: number } {
  const meses = Array.from({ length: 12 }, (_, i) => mesAnterior(e.mes, e.anio, 11 - i));
  const colTotal = 12;
  const colMes = 11;
  const catPorId = new Map(e.categorias.map((c) => [c.id_categoria, c]));
  const hayGrupos = e.categorias.some((c) => c.grupo && c.grupo !== 'ingresos');

  // Clave de agrupación de cada movimiento: categoría para ingresos; grupo (Telcom) o categoría (Familia) para gastos.
  const claveDe = (t: Transaccion): string => {
    const cat = catPorId.get(t.id_categoria);
    if (t.tipo === 'ingreso') return `i:${t.id_categoria}`;
    return hayGrupos ? `g:${cat?.grupo ?? ''}` : `c:${t.id_categoria}`;
  };
  const etiquetaDe = (clave: string): string => {
    const [tipo, id] = [clave.slice(0, 1), clave.slice(2)];
    if (tipo === 'g') return ETIQUETA_GRUPO[id] ?? id;
    return catPorId.get(id)?.nombre ?? 'Sin categoría';
  };

  const montos = new Map<string, number[]>();
  for (const t of e.transacciones) {
    const col = meses.findIndex((m) => perteneceAMes(t.fecha, m.mes, m.anio));
    if (col === -1) continue;
    const clave = claveDe(t);
    if (!montos.has(clave)) montos.set(clave, Array(12).fill(0));
    montos.get(clave)![col] += t.monto;
  }
  const totalDe = (clave: string) => montos.get(clave)!.reduce((s, x) => s + x, 0);
  const ordenar = (prefijo: string) =>
    Array.from(montos.keys())
      .filter((k) => k.startsWith(prefijo))
      .sort((a, b) => totalDe(b) - totalDe(a));

  const filas: FilaHoja[] = [];
  const detalleDe = (clave: string, col: number): Detalle => {
    const [tipo, id] = [clave.slice(0, 1), clave.slice(2)];
    const base = { mes: meses[col].mes, anio: meses[col].anio };
    if (tipo === 'i') return { ...base, tipo: 'ingreso', id_categoria: id };
    if (tipo === 'g') return { ...base, tipo: 'gasto', grupo: id };
    return { ...base, tipo: 'gasto', id_categoria: id };
  };
  const filaDato = (clave: string): FilaHoja => {
    const valores = montos.get(clave)!;
    const i = filas.length;
    return {
      etiqueta: etiquetaDe(clave),
      tipo: 'dato',
      celdas: [
        ...valores.map((v, col) => ({ v, fmt: 'moneda' as const, detalle: detalleDe(clave, col) })),
        { v: totalDe(clave), f: `SUM(${dir(0, i)}:${dir(11, i)})`, fmt: 'moneda' },
      ],
    };
  };
  const filaSubtotal = (etiqueta: string, desde: number, hasta: number, tipo: TipoFila = 'subtotal'): FilaHoja => {
    const celdas: Celda[] = [];
    for (let col = 0; col <= colTotal; col++) {
      let v = 0;
      for (let r = desde; r <= hasta; r++) v += (filas[r].celdas[col].v as number) ?? 0;
      celdas.push({ v, f: formulaSuma(col, desde, hasta), fmt: 'moneda' });
    }
    return { etiqueta, tipo, celdas };
  };

  filas.push({ etiqueta: 'Ingresos', tipo: 'seccion', celdas: [] });
  const desdeIng = filas.length;
  for (const k of ordenar('i:')) filas.push(filaDato(k));
  const totalIngresos = filas.length;
  filas.push(filaSubtotal('Total ingresos', desdeIng, totalIngresos - 1));

  filas.push({ etiqueta: hayGrupos ? 'Gastos por grupo' : 'Gastos por categoría', tipo: 'seccion', celdas: [] });
  const desdeGas = filas.length;
  let personal: number | null = null;
  for (const k of ordenar(hayGrupos ? 'g:' : 'c:')) {
    if (k === 'g:personal') personal = filas.length;
    filas.push(filaDato(k));
  }
  const totalGastos = filas.length;
  filas.push(filaSubtotal('Total gastos', desdeGas, totalGastos - 1));

  const resultado = filas.length;
  filas.push({
    etiqueta: 'Resultado (ingresos − gastos)',
    tipo: 'total',
    celdas: Array.from({ length: colTotal + 1 }, (_, col) => ({
      v: (filas[totalIngresos].celdas[col].v as number) - (filas[totalGastos].celdas[col].v as number),
      f: `${dir(col, totalIngresos)}-${dir(col, totalGastos)}`,
      fmt: 'moneda' as const,
    })),
  });

  const margen = filas.length;
  filas.push({
    etiqueta: 'Margen',
    tipo: 'dato',
    celdas: Array.from({ length: colTotal + 1 }, (_, col) => {
      const ing = filas[totalIngresos].celdas[col].v as number;
      return {
        v: ing === 0 ? null : (filas[resultado].celdas[col].v as number) / ing,
        f: `IF(${dir(col, totalIngresos)}=0,"",${dir(col, resultado)}/${dir(col, totalIngresos)})`,
        fmt: 'pct' as const,
      };
    }),
  });
  void margen;

  const acumulado = filas.length;
  let acum = 0;
  filas.push({
    etiqueta: 'Resultado acumulado',
    tipo: 'subtotal',
    celdas: [
      ...Array.from({ length: 12 }, (_, col) => {
        acum += filas[resultado].celdas[col].v as number;
        return {
          v: acum,
          f: col === 0 ? dir(0, resultado) : `${dir(col - 1, acumulado)}+${dir(col, resultado)}`,
          fmt: 'moneda' as const,
        };
      }),
      vacia(),
    ],
  });

  return {
    hoja: {
      id: 'Resultados',
      titulo: 'Estado de resultados',
      descripcion: 'Lo que entró y salió cada mes. Cada total es la suma de las filas de arriba.',
      columnas: ['Concepto', ...meses.map((m) => `${NOMBRES_MES[m.mes - 1]} ${String(m.anio).slice(2)}`), 'Total 12 m'],
      filas,
    },
    filas: { totalIngresos, totalGastos, resultado, personal },
    colMes,
  };
}

// ---------------------------------------------------------------------------------------------
// Hoja Planilla (mes elegido).

function hojaPlanilla(e: EntradaTablero, res: { filas: FilasClave; colMes: number }): { hoja: Hoja; total: number } | null {
  const personalIds = new Set(e.categorias.filter((c) => c.grupo === 'personal').map((c) => c.id_categoria));
  if (personalIds.size === 0 && e.trabajadores.length === 0) return null;

  const delMes = e.transacciones.filter((t) => t.tipo === 'gasto' && perteneceAMes(t.fecha, e.mes, e.anio));
  const limiteAnio = `${e.anio}-${String(e.mes).padStart(2, '0')}-31`;
  const delAnio = e.transacciones.filter(
    (t) => t.tipo === 'gasto' && t.fecha >= `${e.anio}-01-01` && t.fecha <= limiteAnio,
  );
  const suma = (filas: Transaccion[]) => filas.reduce((s, t) => s + t.monto, 0);
  const adelantosDe = (id: string) =>
    e.deudas
      .filter((d) => d.tipo === 'me_deben' && d.id_trabajador === id && d.estado !== 'pagada')
      .reduce((s, d) => s + d.monto_pendiente, 0);

  const visibles = e.trabajadores.filter(
    (w) => w.activo || delAnio.some((t) => t.id_trabajador === w.id_trabajador),
  );

  // Columnas de datos: 0 Vínculo · 1 Sueldo base · 2 Pagado mes · 3 Pendiente · 4 Adelantos · 5 Neto a pagar · 6 Pagado año
  const filas: FilaHoja[] = [];
  for (const w of visibles) {
    const i = filas.length;
    const sueldo = w.sueldo_base || 0;
    const pagado = suma(delMes.filter((t) => t.id_trabajador === w.id_trabajador));
    const pendiente = Math.max(0, sueldo - pagado);
    const adelantos = adelantosDe(w.id_trabajador);
    filas.push({
      etiqueta: w.nombre,
      tipo: 'dato',
      nota: w.cargo,
      celdas: [
        texto(w.tipo_vinculo === 'honorarios' ? 'Honorarios' : 'Planilla'),
        { v: sueldo, fmt: 'moneda', editar: { entidad: 'trabajador', id: w.id_trabajador, campo: 'sueldo_base' } },
        { v: pagado, fmt: 'moneda', detalle: { mes: e.mes, anio: e.anio, tipo: 'gasto', id_trabajador: w.id_trabajador } },
        { v: pendiente, f: `MAX(0,${dir(1, i)}-${dir(2, i)})`, fmt: 'moneda' },
        { v: adelantos, fmt: 'moneda' },
        { v: Math.max(0, pendiente - adelantos), f: `MAX(0,${dir(3, i)}-${dir(4, i)})`, fmt: 'moneda' },
        { v: suma(delAnio.filter((t) => t.id_trabajador === w.id_trabajador)), fmt: 'moneda' },
      ],
    });
  }

  // Lo de personal que no está atribuido a nadie (EsSalud, seguros, pagos sin asignar) cierra
  // la diferencia con Resultados: sin esta fila la hoja nunca cuadraría.
  const sinTrabajador = suma(delMes.filter((t) => personalIds.has(t.id_categoria) && !t.id_trabajador));
  filas.push({
    etiqueta: 'Personal sin trabajador asignado',
    tipo: 'dato',
    nota: 'EsSalud, seguros y pagos sin asignar',
    celdas: [
      vacia(),
      vacia(),
      { v: sinTrabajador, fmt: 'moneda', detalle: { mes: e.mes, anio: e.anio, tipo: 'gasto', grupo: 'personal', sin_trabajador: true } },
      vacia(),
      vacia(),
      vacia(),
      vacia(),
    ],
  });

  const total = filas.length;
  const ultimo = total - 1;
  filas.push({
    etiqueta: 'Total',
    tipo: 'total',
    celdas: [
      vacia(),
      ...[1, 2, 3, 4, 5, 6].map((col) => ({
        v: filas.reduce((s, f) => s + ((f.celdas[col].v as number) ?? 0), 0),
        f: formulaSuma(col, 0, ultimo),
        fmt: 'moneda' as const,
      })),
    ],
  });

  // Control contra Resultados: personal del mes según la otra hoja, y la diferencia (debe ser 0).
  // Si no da 0, algún pago a un trabajador quedó en una categoría que no es de personal.
  const personalER = res.filas.personal;
  if (personalER !== null) {
    const control = filas.length;
    const valorER = (e.transacciones
      .filter((t) => t.tipo === 'gasto' && personalIds.has(t.id_categoria) && perteneceAMes(t.fecha, e.mes, e.anio))
      .reduce((s, t) => s + t.monto, 0));
    filas.push({
      etiqueta: 'Control: personal según Resultados',
      tipo: 'control',
      celdas: [vacia(), vacia(), { v: valorER, f: ref('Resultados', res.colMes, personalER), fmt: 'moneda' }, vacia(), vacia(), vacia(), vacia()],
    });
    filas.push({
      etiqueta: 'Diferencia (debe ser 0)',
      tipo: 'control',
      celdas: [
        vacia(),
        vacia(),
        { v: (filas[total].celdas[2].v as number) - valorER, f: `${dir(2, total)}-${dir(2, control)}`, fmt: 'moneda' },
        vacia(),
        vacia(),
        vacia(),
        vacia(),
      ],
    });
  }

  return {
    hoja: {
      id: 'Planilla',
      titulo: 'Planilla del mes',
      descripcion: 'Cuánto le toca a cada uno, cuánto ya se le pagó y cuánto falta, descontando adelantos.',
      columnas: ['Trabajador', 'Vínculo', 'Sueldo base', 'Pagado en el mes', 'Pendiente del sueldo', 'Adelantos por descontar', 'Neto a pagar', `Pagado en ${e.anio}`],
      filas,
    },
    total,
  };
}

// ---------------------------------------------------------------------------------------------
// Hoja Caja (mes elegido).

function hojaCaja(e: EntradaTablero, res: { filas: FilasClave; colMes: number }): { hoja: Hoja; total: number } {
  const inicioMes = `${e.anio}-${String(e.mes).padStart(2, '0')}-01`;
  const filas: FilaHoja[] = [];
  for (const c of e.cuentas) {
    const i = filas.length;
    const propias = e.transacciones.filter((t) => t.id_cuenta === c.id_cuenta);
    const neto = (ts: Transaccion[]) => ts.reduce((s, t) => s + (t.tipo === 'ingreso' ? t.monto : -t.monto), 0);
    const previo = neto(propias.filter((t) => t.fecha < inicioMes));
    const inicial = (Number(c.saldo_inicial) || 0) + previo;
    const delMes = propias.filter((t) => perteneceAMes(t.fecha, e.mes, e.anio));
    const ing = delMes.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0);
    const gas = delMes.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);
    filas.push({
      etiqueta: c.nombre,
      tipo: 'dato',
      celdas: [
        { v: inicial, fmt: 'moneda', editar: { entidad: 'cuenta', id: c.id_cuenta, campo: 'saldo_inicial', base: previo } },
        { v: ing, fmt: 'moneda', detalle: { mes: e.mes, anio: e.anio, tipo: 'ingreso', id_cuenta: c.id_cuenta } },
        { v: gas, fmt: 'moneda', detalle: { mes: e.mes, anio: e.anio, tipo: 'gasto', id_cuenta: c.id_cuenta } },
        { v: inicial + ing - gas, f: `${dir(0, i)}+${dir(1, i)}-${dir(2, i)}`, fmt: 'moneda' },
      ],
    });
  }
  const total = filas.length;
  const ultimo = total - 1;
  filas.push({
    etiqueta: 'Total',
    tipo: 'total',
    celdas: [0, 1, 2, 3].map((col) => ({
      v: filas.reduce((s, f) => s + ((f.celdas[col].v as number) ?? 0), 0),
      f: formulaSuma(col, 0, ultimo),
      fmt: 'moneda' as const,
    })),
  });

  // Control: lo que entró y salió por las cuentas tiene que ser lo mismo que dice Resultados.
  // Difiere si hay movimientos en cuentas dadas de baja.
  const control = filas.length;
  const enMes = e.transacciones.filter((t) => perteneceAMes(t.fecha, e.mes, e.anio));
  const ingER = enMes.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0);
  const gasER = enMes.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);
  filas.push({
    etiqueta: 'Control: según Resultados',
    tipo: 'control',
    celdas: [
      vacia(),
      { v: ingER, f: ref('Resultados', res.colMes, res.filas.totalIngresos), fmt: 'moneda' },
      { v: gasER, f: ref('Resultados', res.colMes, res.filas.totalGastos), fmt: 'moneda' },
      vacia(),
    ],
  });
  filas.push({
    etiqueta: 'Diferencia (debe ser 0)',
    tipo: 'control',
    celdas: [
      vacia(),
      { v: (filas[total].celdas[1].v as number) - ingER, f: `${dir(1, total)}-${dir(1, control)}`, fmt: 'moneda' },
      { v: (filas[total].celdas[2].v as number) - gasER, f: `${dir(2, total)}-${dir(2, control)}`, fmt: 'moneda' },
      vacia(),
    ],
  });

  return {
    hoja: {
      id: 'Caja',
      titulo: 'Caja y cuentas',
      descripcion: 'Saldo de cada cuenta: lo que había al empezar el mes, más lo que entró, menos lo que salió.',
      columnas: ['Cuenta', 'Saldo al inicio del mes', 'Ingresos', 'Gastos', 'Saldo final'],
      filas,
    },
    total,
  };
}

// ---------------------------------------------------------------------------------------------
// Hoja Por cobrar y por pagar (deudas abiertas).

const POR_PAGAR = 'Por pagar';
const POR_COBRAR = 'Por cobrar';

function diasEntreYmd(desde: string, hasta: string): number {
  const utc = (f: string) => {
    const [a, m, d] = f.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(hasta) - utc(desde)) / 86400000);
}

function hojaDeudas(e: EntradaTablero): { hoja: Hoja; porPagar: number; porCobrar: number } {
  const nombreTrabajador = new Map(e.trabajadores.map((w) => [w.id_trabajador, w.nombre]));
  const abiertas = e.deudas
    .filter((d) => d.estado !== 'pagada' && d.monto_pendiente > 0)
    .sort((a, b) => (a.fecha_vencimiento || '9999').localeCompare(b.fecha_vencimiento || '9999'));

  // Columnas de datos: 0 Tipo · 1 Trabajador · 2 Vence · 3 Días · 4 Pendiente
  const filas: FilaHoja[] = abiertas.map((d, i) => ({
    etiqueta: d.persona || d.descripcion,
    tipo: 'dato' as const,
    nota: d.descripcion,
    celdas: [
      texto(d.tipo === 'debo' ? POR_PAGAR : POR_COBRAR),
      texto(d.id_trabajador ? nombreTrabajador.get(d.id_trabajador) ?? '' : ''),
      { v: d.fecha_vencimiento || null, fmt: 'fecha' as const, editar: { entidad: 'deuda' as const, id: d.id_deuda, campo: 'fecha_vencimiento' as const } },
      d.fecha_vencimiento
        ? { v: diasEntreYmd(e.hoy, d.fecha_vencimiento), f: `${dir(2, i)}-TODAY()`, fmt: 'entero' as const }
        : vacia(),
      { v: d.monto_pendiente, fmt: 'moneda' as const, editar: { entidad: 'deuda' as const, id: d.id_deuda, campo: 'monto_pendiente' as const } },
    ],
  }));

  // Capturado ANTES de agregar los totales: si no, con cero deudas el segundo total
  // vería una fila (el primer total) y armaría un rango invertido B2:B1.
  const cantidad = filas.length;
  const ultimo = cantidad - 1;
  const sumarSi = (tipo: string) =>
    cantidad === 0 ? '0' : `SUMIF(${dir(0, 0)}:${dir(0, ultimo)},"${tipo}",${dir(4, 0)}:${dir(4, ultimo)})`;
  const total = (tipo: string) =>
    abiertas.filter((d) => (d.tipo === 'debo' ? POR_PAGAR : POR_COBRAR) === tipo).reduce((s, d) => s + d.monto_pendiente, 0);

  const porPagar = filas.length;
  filas.push({ etiqueta: 'Total por pagar', tipo: 'total', celdas: [vacia(), vacia(), vacia(), vacia(), { v: total(POR_PAGAR), f: sumarSi(POR_PAGAR), fmt: 'moneda' }] });
  const porCobrar = filas.length;
  filas.push({ etiqueta: 'Total por cobrar', tipo: 'total', celdas: [vacia(), vacia(), vacia(), vacia(), { v: total(POR_COBRAR), f: sumarSi(POR_COBRAR), fmt: 'moneda' }] });

  return {
    hoja: {
      id: 'PorCobrarPagar',
      titulo: 'Por cobrar y por pagar',
      descripcion: 'Deudas abiertas ordenadas por vencimiento. Días negativos = ya venció.',
      columnas: ['Concepto', 'Tipo', 'Trabajador', 'Vence', 'Días', 'Pendiente'],
      filas,
    },
    porPagar,
    porCobrar,
  };
}

// ---------------------------------------------------------------------------------------------
// Hoja Resumen: solo referencias a las otras hojas.

function hojaResumen(
  res: { filas: FilasClave; colMes: number; hoja: Hoja },
  caja: { hoja: Hoja; total: number },
  deudas: { hoja: Hoja; porPagar: number; porCobrar: number },
  planilla: { hoja: Hoja; total: number } | null,
): Hoja {
  const filas: FilaHoja[] = [];
  const valorDe = (h: Hoja, col: number, i: number) => (h.filas[i].celdas[col].v as number | null) ?? 0;
  const R = res.hoja;

  // Cada indicador: etiqueta, valor, fórmula, formato, explicación en castellano llano.
  const agregar = (etiqueta: string, v: number | null, f: string, fmt: Formato, explicacion: string, tipo: TipoFila = 'dato') => {
    filas.push({ etiqueta, tipo, celdas: [{ v, f, fmt }, texto(explicacion)] });
    return filas.length - 1;
  };
  const b = (i: number) => dir(0, i);

  filas.push({ etiqueta: 'Posición', tipo: 'seccion', celdas: [] });
  const caja_ = agregar('Caja disponible', valorDe(caja.hoja, 3, caja.total), ref('Caja', 3, caja.total), 'moneda', 'Saldo final de todas las cuentas (hoja Caja).');
  const cobrar = agregar('Por cobrar', valorDe(deudas.hoja, 4, deudas.porCobrar), ref('PorCobrarPagar', 4, deudas.porCobrar), 'moneda', 'Lo que nos deben (hoja Por cobrar y por pagar).');
  const pagar = agregar('Por pagar', valorDe(deudas.hoja, 4, deudas.porPagar), ref('PorCobrarPagar', 4, deudas.porPagar), 'moneda', 'Lo que debemos: planilla, SUNAT, proveedores.');
  const vCaja = filas[caja_].celdas[0].v as number;
  agregar(
    'Posición neta',
    vCaja + (filas[cobrar].celdas[0].v as number) - (filas[pagar].celdas[0].v as number),
    `${b(caja_)}+${b(cobrar)}-${b(pagar)}`,
    'moneda',
    'Caja + por cobrar − por pagar: con cuánto quedaríamos si todo se cobrara y pagara hoy.',
    'total',
  );

  filas.push({ etiqueta: 'Mes', tipo: 'seccion', celdas: [] });
  const ing = agregar('Ingresos del mes', valorDe(R, res.colMes, res.filas.totalIngresos), ref('Resultados', res.colMes, res.filas.totalIngresos), 'moneda', 'Total ingresos de la columna del mes en Resultados.');
  agregar('Gastos del mes', valorDe(R, res.colMes, res.filas.totalGastos), ref('Resultados', res.colMes, res.filas.totalGastos), 'moneda', 'Total gastos de la columna del mes en Resultados.');
  const resultado = agregar('Resultado del mes', valorDe(R, res.colMes, res.filas.resultado), ref('Resultados', res.colMes, res.filas.resultado), 'moneda', 'Ingresos − gastos del mes.', 'total');
  const vIng = filas[ing].celdas[0].v as number;
  agregar('Margen del mes', vIng === 0 ? null : (filas[resultado].celdas[0].v as number) / vIng, `IF(${b(ing)}=0,"",${b(resultado)}/${b(ing)})`, 'pct', 'Qué parte de lo que entró quedó.');

  if (planilla) {
    filas.push({ etiqueta: 'Personal', tipo: 'seccion', celdas: [] });
    const costo = agregar('Costo de personal del mes', valorDe(planilla.hoja, 2, planilla.total), ref('Planilla', 2, planilla.total), 'moneda', 'Total pagado en el mes (hoja Planilla).');
    agregar('Personal / ingresos', vIng === 0 ? null : (filas[costo].celdas[0].v as number) / vIng, `IF(${b(ing)}=0,"",${b(costo)}/${b(ing)})`, 'pct', 'Cuánto de cada sol que entra se va en personal.');
    agregar('Planilla neta por pagar', valorDe(planilla.hoja, 5, planilla.total), ref('Planilla', 5, planilla.total), 'moneda', 'Sueldos pendientes del mes, ya descontados los adelantos.');
  }

  filas.push({ etiqueta: 'Aguante', tipo: 'seccion', celdas: [] });
  const tg = res.filas.totalGastos;
  const ultimos3 = [res.colMes - 2, res.colMes - 1, res.colMes].map((c) => valorDe(R, c, tg));
  const promedio = agregar(
    'Gasto promedio (3 meses)',
    ultimos3.reduce((s, x) => s + x, 0) / 3,
    `AVERAGE(${ref('Resultados', res.colMes - 2, tg)}:${dir(res.colMes, tg)})`,
    'moneda',
    'Promedio de gastos de los últimos 3 meses en Resultados.',
  );
  const vProm = filas[promedio].celdas[0].v as number;
  agregar('Meses de caja', vProm === 0 ? null : vCaja / vProm, `IF(${b(promedio)}=0,"",${b(caja_)}/${b(promedio)})`, 'meses', 'Cuántos meses se aguanta con la caja actual si no entrara nada.', 'total');

  return {
    id: 'Resumen',
    titulo: 'Resumen',
    descripcion: 'Cada número sale de otra hoja: toca uno para ver de dónde viene.',
    columnas: ['Indicador', 'Valor', 'Cómo se calcula'],
    filas,
  };
}

// ---------------------------------------------------------------------------------------------

export function construirTablero(e: EntradaTablero): Tablero {
  const res = hojaResultados(e);
  const planilla = hojaPlanilla(e, res);
  const caja = hojaCaja(e, res);
  const deudas = hojaDeudas(e);
  const resumen = hojaResumen(res, caja, deudas, planilla);
  return {
    hojas: [resumen, res.hoja, ...(planilla ? [planilla.hoja] : []), caja.hoja, deudas.hoja],
    mes: e.mes,
    anio: e.anio,
  };
}

// ---------------------------------------------------------------------------------------------
// Presentación de fórmulas en Excel en español (separador ';', nombres traducidos).

const FUNCIONES_ES: Record<string, string> = {
  SUM: 'SUMA',
  IF: 'SI',
  MAX: 'MAX',
  SUMIF: 'SUMAR.SI',
  TODAY: 'HOY',
  AVERAGE: 'PROMEDIO',
};

export function formulaEnEspanol(f: string): string {
  let dentroDeTexto = false;
  let salida = '';
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c === '"') dentroDeTexto = !dentroDeTexto;
    salida += !dentroDeTexto && c === ',' ? ';' : c;
  }
  return '=' + salida.replace(/\b(SUMIF|SUM|IF|MAX|TODAY|AVERAGE)\(/g, (_, fn: string) => `${FUNCIONES_ES[fn]}(`);
}

/** Referencias 'Hoja!B5' que aparecen en una fórmula, para poder saltar a ellas desde la UI. */
export function referenciasExternas(f: string): Array<{ hoja: IdHoja; columna: number; fila: number }> {
  const salida: Array<{ hoja: IdHoja; columna: number; fila: number }> = [];
  for (const m of f.matchAll(/\b(Resumen|Resultados|Planilla|Caja|PorCobrarPagar)!([A-Z]+)(\d+)/g)) {
    let col = 0;
    for (const ch of m[2]) col = col * 26 + (ch.charCodeAt(0) - 64);
    salida.push({ hoja: m[1] as IdHoja, columna: col - 1, fila: Number(m[3]) });
  }
  return salida;
}

// ---------------------------------------------------------------------------------------------
// Fórmulas en castellano: "=B3+B4-B5" → "Caja disponible + Por cobrar − Por pagar", con cada
// referencia como pieza tocable y su valor. Es lo que ve el usuario; las letras y números de
// celda quedan solo para el .xlsx.

export type PiezaExplicacion =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ref'; hoja: IdHoja; fila: number; columna: number; etiqueta: string; valor: number | string | null; fmt?: Formato };

interface Nodo {
  t: 'num' | 'str' | 'ref' | 'rango' | 'fn' | 'bin' | 'neg';
  v?: string;
  hoja?: IdHoja;
  a?: { col: number; fila: number };
  b?: { col: number; fila: number };
  args?: Nodo[];
  op?: string;
  izq?: Nodo;
  der?: Nodo;
}

function parsearFormula(f: string, hojaActual: IdHoja): Nodo {
  const tokens = f.match(/"[^"]*"|[A-Za-z]+!?[A-Z]*\d*(?::[A-Z]+\d+)?|\d+(?:\.\d+)?|[()+\-*/,=]/g) ?? [];
  let i = 0;
  const celda = (s: string) => {
    const m = s.match(/([A-Z]+)(\d+)/)!;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col: col - 1, fila: Number(m[2]) };
  };
  const primario = (): Nodo => {
    const tk = tokens[i++];
    if (tk === '(') {
      const n = expresion();
      i++; // ')'
      return n;
    }
    if (tk === '-') return { t: 'neg', izq: primario() };
    if (tk.startsWith('"')) return { t: 'str', v: tk.slice(1, -1) };
    if (/^\d/.test(tk)) return { t: 'num', v: tk };
    if (tokens[i] === '(' && /^[A-Z]+$/.test(tk)) {
      i++;
      const args: Nodo[] = [];
      while (tokens[i] !== ')') {
        args.push(comparacion());
        if (tokens[i] === ',') i++;
      }
      i++;
      return { t: 'fn', v: tk, args };
    }
    const [hojaTxt, resto] = tk.includes('!') ? tk.split('!') : [hojaActual, tk];
    const [a, b] = resto.split(':');
    return b
      ? { t: 'rango', hoja: hojaTxt as IdHoja, a: celda(a), b: celda(b) }
      : { t: 'ref', hoja: hojaTxt as IdHoja, a: celda(a) };
  };
  const binario = (siguiente: () => Nodo, ops: string[]) => (): Nodo => {
    let n = siguiente();
    while (ops.includes(tokens[i])) {
      const op = tokens[i++];
      n = { t: 'bin', op, izq: n, der: siguiente() };
    }
    return n;
  };
  const termino = binario(primario, ['*', '/']);
  const expresion = binario(termino, ['+', '-']);
  const comparacion = binario(expresion, ['=']);
  return comparacion();
}

export function explicarFormula(tablero: Tablero, hojaId: IdHoja, f: string): PiezaExplicacion[] {
  const hojaDe = (id: IdHoja) => tablero.hojas.find((h) => h.id === id);
  const piezaRef = (hoja: IdHoja, col: number, fila: number): PiezaExplicacion => {
    const h = hojaDe(hoja);
    const fh = h?.filas[fila - 2];
    const celda = fh?.celdas[col - 1];
    // Con una sola columna de valores el encabezado no agrega nada; con varias, sí ("Personal · Sep 26").
    const columnasValor = (h?.columnas.length ?? 0) - 1;
    const sufijo = columnasValor > 2 && h ? ` · ${h.columnas[col]}` : '';
    const enOtra = hoja !== hojaId && h ? ` (${h.titulo})` : '';
    return { tipo: 'ref', hoja, fila, columna: col, etiqueta: `${fh?.etiqueta ?? '?'}${sufijo}${enOtra}`, valor: celda?.v ?? null, fmt: celda?.fmt };
  };
  const texto = (t: string): PiezaExplicacion => ({ tipo: 'texto', texto: t });

  const rangoComoLista = (n: Nodo): PiezaExplicacion[] => {
    const { a, b, hoja } = n as Required<Pick<Nodo, 'a' | 'b' | 'hoja'>>;
    if (a.col === b.col) {
      const filas = Array.from({ length: b.fila - a.fila + 1 }, (_, k) => a.fila + k);
      const piezas = (fs: number[]) => fs.flatMap((fi, k) => [...(k ? [texto(' + ')] : []), piezaRef(hoja, a.col, fi)]);
      return filas.length <= 6 ? piezas(filas) : [...piezas([filas[0]]), texto(` + … (${filas.length} filas) + `), piezaRef(hoja, a.col, filas[filas.length - 1])];
    }
    const h = hojaDe(hoja);
    const fila = h?.filas[a.fila - 2]?.etiqueta ?? '';
    return [texto(`${fila}, de ${h?.columnas[a.col]} a ${h?.columnas[b.col]}`)];
  };

  const OPS: Record<string, string> = { '+': ' + ', '-': ' − ', '*': ' × ', '/': ' ÷ ', '=': ' = ' };
  const render = (n: Nodo): PiezaExplicacion[] => {
    switch (n.t) {
      case 'num':
        return [texto(n.v!)];
      case 'str':
        return [texto(n.v ? `“${n.v}”` : 'vacío')];
      case 'ref':
        return [piezaRef(n.hoja!, n.a!.col, n.a!.fila)];
      case 'rango':
        return rangoComoLista(n);
      case 'neg':
        return [texto('−'), ...render(n.izq!)];
      case 'bin':
        return [...render(n.izq!), texto(OPS[n.op!]), ...render(n.der!)];
      case 'fn': {
        const args = n.args!;
        switch (n.v) {
          case 'SUM':
            return args.length === 1 && args[0].t === 'rango' ? rangoComoLista(args[0]) : args.flatMap((x, k) => [...(k ? [texto(' + ')] : []), ...render(x)]);
          case 'MAX':
            // MAX(0, x): "x, sin bajar de 0".
            return [...render(args[1]), texto(' (si da negativo, 0)')];
          case 'IF':
            // IF(x=0, "", a/b): lo único que importa leer es a/b.
            return render(args[2]);
          case 'AVERAGE':
            return [texto('Promedio de '), ...render(args[0])];
          case 'TODAY':
            return [texto('hoy')];
          case 'SUMIF': {
            const h = hojaDe(args[0].hoja ?? hojaId);
            return [texto(`Suma de «${h?.columnas[args[2].a!.col]}» donde «${h?.columnas[args[0].a!.col]}» es “${args[1].v}”`)];
          }
          default:
            return [texto(`${n.v}(…)`)];
        }
      }
    }
  };
  return render(parsearFormula(f, hojaId));
}
