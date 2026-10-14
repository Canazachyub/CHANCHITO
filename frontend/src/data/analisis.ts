/**
 * Análisis del mes — lógica PURA, sin Dexie ni React, para poder testearla con Vitest.
 *
 * Todo se calcula en el cliente sobre lo que ya está en Dexie (igual que useResumenMensual), así
 * que funciona sin conexión. data/api.ts junta las filas del espacio activo y llama a estas
 * funciones; la UI solo pinta el resultado.
 *
 * Todas las funciones reciben filas ya filtradas por espacio y sin `eliminado`.
 */
import type { Categoria, Cuenta, Deuda, Trabajador, Transaccion, Usuario } from './types';

export function perteneceAMes(fechaYmd: string, mes: number, anio: number): boolean {
  const [anioFecha, mesFecha] = fechaYmd.split('-').map(Number);
  return anioFecha === anio && mesFecha === mes;
}

/** El mes `n` meses antes de (mes, anio). */
export function mesAnterior(mes: number, anio: number, n = 1): { mes: number; anio: number } {
  const total = anio * 12 + (mes - 1) - n;
  return { mes: (total % 12) + 1, anio: Math.floor(total / 12) };
}

function sumar(filas: Transaccion[], tipo: 'gasto' | 'ingreso'): number {
  return filas.reduce((s, t) => (t.tipo === tipo ? s + t.monto : s), 0);
}

// ---------------------------------------------------------------------------------------------
// Por persona: quién movió cuánto en el mes.

export interface ResumenPersona {
  id_usuario: string;
  nombre: string;
  gastos: number;
  ingresos: number;
  movimientos: number;
  /** 0..1 — fracción del gasto total del mes. */
  proporcion: number;
  categoria_principal: { nombre: string; icono: string; total: number } | null;
}

export function resumenPorPersona(
  delMes: Transaccion[],
  usuarios: Usuario[],
  categorias: Categoria[],
): ResumenPersona[] {
  const totalGastos = sumar(delMes, 'gasto');
  const porUsuario = new Map<string, Transaccion[]>();
  for (const t of delMes) {
    const clave = t.id_usuario || '';
    if (!porUsuario.has(clave)) porUsuario.set(clave, []);
    porUsuario.get(clave)!.push(t);
  }

  return Array.from(porUsuario.entries())
    .map(([id_usuario, filas]) => {
      const gastos = sumar(filas, 'gasto');
      const porCategoria = new Map<string, number>();
      for (const t of filas) {
        if (t.tipo === 'gasto') porCategoria.set(t.id_categoria, (porCategoria.get(t.id_categoria) ?? 0) + t.monto);
      }
      let principal: ResumenPersona['categoria_principal'] = null;
      for (const [idCat, total] of porCategoria) {
        if (!principal || total > principal.total) {
          const cat = categorias.find((c) => c.id_categoria === idCat);
          principal = { nombre: cat?.nombre ?? 'Sin categoría', icono: cat?.icono ?? '📦', total };
        }
      }
      return {
        id_usuario,
        nombre: usuarios.find((u) => u.id_usuario === id_usuario)?.nombre ?? 'Sin asignar',
        gastos,
        ingresos: sumar(filas, 'ingreso'),
        movimientos: filas.length,
        proporcion: totalGastos > 0 ? gastos / totalGastos : 0,
        categoria_principal: principal,
      };
    })
    .sort((a, b) => b.gastos - a.gastos || b.ingresos - a.ingresos);
}

// ---------------------------------------------------------------------------------------------
// Variaciones: cada categoría contra su promedio de los meses anteriores.

export interface VariacionCategoria {
  id_categoria: string;
  nombre: string;
  icono: string;
  color: string;
  actual: number;
  /** Promedio mensual de los `mesesBase` meses anteriores (contando los meses en cero). */
  promedio: number;
  /** Lo que "tocaba" gastar a esta altura del mes según el promedio. Igual a `promedio` en meses cerrados. */
  esperado: number;
  /** (actual − esperado) / esperado. null si no hay historia con qué comparar. */
  variacion: number | null;
}

/**
 * `fraccionMes` (0..1): qué parte del mes ya pasó. Comparar 10 días de gasto contra el promedio
 * de meses completos haría que todo mes en curso se vea "bajo"; se compara contra el promedio
 * prorrateado. Para un mes cerrado es 1.
 */
export function variacionesPorCategoria(
  transacciones: Transaccion[],
  categorias: Categoria[],
  mes: number,
  anio: number,
  fraccionMes = 1,
  mesesBase = 3,
): VariacionCategoria[] {
  const gastos = transacciones.filter((t) => t.tipo === 'gasto');
  const actualPorCat = new Map<string, number>();
  const historiaPorCat = new Map<string, number>();

  const periodosBase = Array.from({ length: mesesBase }, (_, i) => mesAnterior(mes, anio, i + 1));

  for (const t of gastos) {
    if (perteneceAMes(t.fecha, mes, anio)) {
      actualPorCat.set(t.id_categoria, (actualPorCat.get(t.id_categoria) ?? 0) + t.monto);
    } else if (periodosBase.some((p) => perteneceAMes(t.fecha, p.mes, p.anio))) {
      historiaPorCat.set(t.id_categoria, (historiaPorCat.get(t.id_categoria) ?? 0) + t.monto);
    }
  }

  const ids = new Set([...actualPorCat.keys(), ...historiaPorCat.keys()]);
  const fraccion = Math.min(Math.max(fraccionMes, 0), 1);

  return Array.from(ids)
    .map((id_categoria) => {
      const cat = categorias.find((c) => c.id_categoria === id_categoria);
      const actual = actualPorCat.get(id_categoria) ?? 0;
      const promedio = (historiaPorCat.get(id_categoria) ?? 0) / mesesBase;
      const esperado = promedio * fraccion;
      return {
        id_categoria,
        nombre: cat?.nombre ?? 'Sin categoría',
        icono: cat?.icono ?? '📦',
        color: cat?.color ?? '#86868B',
        actual,
        promedio,
        esperado,
        variacion: esperado > 0 ? (actual - esperado) / esperado : null,
      };
    })
    .sort((a, b) => Math.abs(b.actual - b.esperado) - Math.abs(a.actual - a.esperado));
}

// ---------------------------------------------------------------------------------------------
// Indicadores del mes.

/** Lo que escribe backend/24_obligaciones.js en la deuda que genera cada mes. */
export const PREFIJO_DEUDA_OBLIGACION = 'Obligación mensual:';

export interface Indicadores {
  ingresos: number;
  gastos: number;
  /** saldo / ingresos. null si no hubo ingresos. */
  tasa_ahorro: number | null;
  /** Gasto del grupo 'personal' (CONTRACT § 6-bis). 0 en Familia, que no tiene grupos. */
  costo_personal: number;
  /** costo_personal / ingresos. null sin ingresos o sin grupo personal. */
  ratio_personal: number | null;
  gasto_por_grupo: Array<{ grupo: string; total: number; proporcion: number }>;
  obligaciones: { cantidad: number; estimado: number; pagado: number; pendiente: number };
  /** Pagos de personal sin trabajador: lo que la ficha por trabajador no puede ver. */
  personal_sin_asignar: { cantidad: number; total: number };
}

export function calcularIndicadores(
  delMes: Transaccion[],
  categorias: Categoria[],
  deudas: Deuda[],
  mes: number,
  anio: number,
): Indicadores {
  const ingresos = sumar(delMes, 'ingreso');
  const gastos = sumar(delMes, 'gasto');
  const grupoDe = new Map(categorias.map((c) => [c.id_categoria, c.grupo ?? '']));
  const hayGrupoPersonal = categorias.some((c) => c.grupo === 'personal');

  const porGrupo = new Map<string, number>();
  const sinAsignar = { cantidad: 0, total: 0 };
  for (const t of delMes) {
    if (t.tipo !== 'gasto') continue;
    const grupo = grupoDe.get(t.id_categoria) ?? '';
    porGrupo.set(grupo, (porGrupo.get(grupo) ?? 0) + t.monto);
    if (grupo === 'personal' && !t.id_trabajador) {
      sinAsignar.cantidad += 1;
      sinAsignar.total += t.monto;
    }
  }
  const costo_personal = porGrupo.get('personal') ?? 0;

  const obligacionesDelMes = deudas.filter(
    (d) => d.descripcion.startsWith(PREFIJO_DEUDA_OBLIGACION) && perteneceAMes(d.fecha_vencimiento, mes, anio),
  );
  const estimado = obligacionesDelMes.reduce((s, d) => s + d.monto_original, 0);
  const pendiente = obligacionesDelMes.reduce((s, d) => s + d.monto_pendiente, 0);

  return {
    ingresos,
    gastos,
    tasa_ahorro: ingresos > 0 ? (ingresos - gastos) / ingresos : null,
    costo_personal,
    ratio_personal: hayGrupoPersonal && ingresos > 0 ? costo_personal / ingresos : null,
    gasto_por_grupo: Array.from(porGrupo.entries())
      .map(([grupo, total]) => ({ grupo, total, proporcion: gastos > 0 ? total / gastos : 0 }))
      .sort((a, b) => b.total - a.total),
    obligaciones: { cantidad: obligacionesDelMes.length, estimado, pagado: estimado - pendiente, pendiente },
    personal_sin_asignar: sinAsignar,
  };
}

// ---------------------------------------------------------------------------------------------
// Ficha por trabajador.

export interface FichaTrabajador {
  trabajador: Trabajador;
  total_mes: number;
  /** Del 1 de enero al último día del mes elegido. */
  total_anio: number;
  por_categoria: Array<{ id_categoria: string; nombre: string; icono: string; total: number }>;
  ultimo_pago: string | null;
  /** Meses del año (hasta el elegido) con al menos un pago. Sirve para ver huecos de planilla. */
  meses_con_pago: number;
  /** Suma de `monto_pendiente` de las deudas me_deben del trabajador que siguen abiertas. */
  adelantos_pendientes: number;
  /** Pagos programados a su nombre (deudas `debo`, típicamente su planilla del mes) sin cerrar. */
  por_pagar: number;
  /** Días hasta `fecha_fin` del contrato contados desde `hoy`; negativo si ya venció, null si es indefinido. */
  dias_para_fin: number | null;
}

/** Diferencia en días entre dos 'yyyy-MM-dd', sin depender de la zona horaria. */
export function diasEntre(desde: string, hasta: string): number {
  const utc = (f: string) => {
    const [a, m, d] = f.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(hasta) - utc(desde)) / 86400000);
}

export function fichasTrabajadores(
  trabajadores: Trabajador[],
  transacciones: Transaccion[],
  deudas: Deuda[],
  categorias: Categoria[],
  mes: number,
  anio: number,
  hoy: string,
): FichaTrabajador[] {
  const limite = `${anio}-${String(mes).padStart(2, '0')}-31`;
  const inicio = `${anio}-01-01`;

  return trabajadores
    .map((trabajador) => {
      const pagos = transacciones.filter((t) => t.tipo === 'gasto' && t.id_trabajador === trabajador.id_trabajador);
      const delAnio = pagos.filter((t) => t.fecha >= inicio && t.fecha <= limite);

      const porCategoria = new Map<string, number>();
      for (const t of delAnio) porCategoria.set(t.id_categoria, (porCategoria.get(t.id_categoria) ?? 0) + t.monto);

      const abiertas = deudas.filter((d) => d.id_trabajador === trabajador.id_trabajador && d.estado !== 'pagada');
      const pendienteDe = (tipo: Deuda['tipo']) =>
        abiertas.filter((d) => d.tipo === tipo).reduce((s, d) => s + d.monto_pendiente, 0);

      const ultimo = pagos.filter((t) => t.fecha <= limite).reduce<string | null>((max, t) => (!max || t.fecha > max ? t.fecha : max), null);

      return {
        trabajador,
        total_mes: pagos.filter((t) => perteneceAMes(t.fecha, mes, anio)).reduce((s, t) => s + t.monto, 0),
        total_anio: delAnio.reduce((s, t) => s + t.monto, 0),
        por_categoria: Array.from(porCategoria.entries())
          .map(([id_categoria, total]) => {
            const cat = categorias.find((c) => c.id_categoria === id_categoria);
            return { id_categoria, nombre: cat?.nombre ?? 'Sin categoría', icono: cat?.icono ?? '📦', total };
          })
          .sort((a, b) => b.total - a.total),
        ultimo_pago: ultimo,
        meses_con_pago: new Set(delAnio.map((t) => t.fecha.slice(0, 7))).size,
        adelantos_pendientes: pendienteDe('me_deben'),
        por_pagar: pendienteDe('debo'),
        dias_para_fin: trabajador.fecha_fin ? diasEntre(hoy, trabajador.fecha_fin) : null,
      };
    })
    // Los dados de baja solo aparecen si tienen algo que mostrar este año.
    .filter((f) => f.trabajador.activo || f.total_anio > 0 || f.adelantos_pendientes > 0 || f.por_pagar > 0)
    .sort((a, b) => b.total_mes - a.total_mes || b.total_anio - a.total_anio);
}

// ---------------------------------------------------------------------------------------------
// Saldos por cuenta.

export interface SaldoCuenta {
  cuenta: Cuenta;
  saldo: number;
  /** Neto del mes elegido (ingresos − gastos de esa cuenta). */
  neto_mes: number;
}

/**
 * Saldo = saldo_inicial + ingresos − gastos de toda la historia, igual que getCuentas() del
 * backend. Las transferencias entre cuentas no viajan al cliente, así que tampoco entran acá.
 */
export function saldosPorCuenta(cuentas: Cuenta[], transacciones: Transaccion[], mes: number, anio: number): SaldoCuenta[] {
  return cuentas.map((cuenta) => {
    const propias = transacciones.filter((t) => t.id_cuenta === cuenta.id_cuenta);
    const neto = (filas: Transaccion[]) => sumar(filas, 'ingreso') - sumar(filas, 'gasto');
    return {
      cuenta,
      saldo: (Number(cuenta.saldo_inicial) || 0) + neto(propias),
      neto_mes: neto(propias.filter((t) => perteneceAMes(t.fecha, mes, anio))),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Serie mensual: ingresos, gastos, neto y saldo acumulado (gráficos G1–G4).

export interface PuntoMensual {
  mes: number;
  anio: number;
  ingresos: number;
  gastos: number;
  neto: number;
  /** Σ saldo_inicial de las cuentas activas + neto acumulado de toda la historia hasta fin de ese mes. */
  saldo_acumulado: number;
}

/**
 * Los `meses` que terminan en (mesHasta, anioHasta) inclusive. El saldo acumulado arrastra TODA la
 * historia previa a la ventana, no solo los meses mostrados; por eso recibe todas las filas.
 */
export function serieMensual(
  cuentas: Cuenta[],
  transacciones: Transaccion[],
  meses: number,
  mesHasta: number,
  anioHasta: number,
): PuntoMensual[] {
  const periodos = Array.from({ length: meses }, (_, i) => mesAnterior(mesHasta, anioHasta, meses - 1 - i));
  const claveDe = (p: { mes: number; anio: number }) => `${p.anio}-${String(p.mes).padStart(2, '0')}`;
  const primera = claveDe(periodos[0]);

  const porMes = new Map<string, { ingresos: number; gastos: number }>();
  let previo = 0; // neto de todo lo anterior a la ventana
  for (const t of transacciones) {
    const clave = t.fecha.slice(0, 7);
    const signo = t.tipo === 'ingreso' ? 1 : -1;
    if (clave < primera) {
      previo += signo * t.monto;
      continue;
    }
    const actual = porMes.get(clave) ?? { ingresos: 0, gastos: 0 };
    if (t.tipo === 'ingreso') actual.ingresos += t.monto;
    else actual.gastos += t.monto;
    porMes.set(clave, actual);
  }

  let acumulado = cuentas.filter((c) => c.activo).reduce((s, c) => s + (Number(c.saldo_inicial) || 0), 0) + previo;
  return periodos.map((p) => {
    const tot = porMes.get(claveDe(p));
    const ingresos = tot?.ingresos ?? 0;
    const gastos = tot?.gastos ?? 0;
    const neto = ingresos - gastos;
    acumulado += neto;
    return { mes: p.mes, anio: p.anio, ingresos, gastos, neto, saldo_acumulado: acumulado };
  });
}

// ---------------------------------------------------------------------------------------------
// Exportación para el contador.

const ETIQUETA_GRUPO_CSV: Record<string, string> = {
  operativos: 'Operativos',
  personal: 'Personal',
  activos: 'Activos fijos',
  impuestos: 'Impuestos',
  ingresos: 'Ingresos',
};

function celdaCsv(valor: string | number): string {
  const texto = String(valor);
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Una fila por movimiento, ordenado por fecha. El contador lo pivotea por grupo o categoría. */
export function generarCsv(
  delMes: Transaccion[],
  ref: { categorias: Categoria[]; cuentas: Cuenta[]; usuarios: Usuario[]; trabajadores: Trabajador[] },
): string {
  const cabecera = ['fecha', 'tipo', 'grupo', 'categoria', 'monto', 'descripcion', 'registrado_por', 'trabajador', 'cuenta', 'origen'];
  const filas = [...delMes]
    .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora))
    .map((t) => {
      const cat = ref.categorias.find((c) => c.id_categoria === t.id_categoria);
      return [
        t.fecha,
        t.tipo,
        ETIQUETA_GRUPO_CSV[cat?.grupo ?? ''] ?? '',
        cat?.nombre ?? '',
        t.monto.toFixed(2),
        t.descripcion,
        ref.usuarios.find((u) => u.id_usuario === t.id_usuario)?.nombre ?? '',
        ref.trabajadores.find((w) => w.id_trabajador === t.id_trabajador)?.nombre ?? '',
        ref.cuentas.find((c) => c.id_cuenta === t.id_cuenta)?.nombre ?? '',
        t.origen,
      ]
        .map(celdaCsv)
        .join(',');
    });
  return [cabecera.join(','), ...filas].join('\r\n');
}
