import { describe, expect, it } from 'vitest';
import type { Categoria, Cuenta, Deuda, Trabajador, Transaccion, Usuario } from './types';
import {
  calcularIndicadores,
  fichasTrabajadores,
  generarCsv,
  mesAnterior,
  resumenPorPersona,
  saldosPorCuenta,
  serieMensual,
  variacionesPorCategoria,
} from './analisis';

let n = 0;
function trx(p: Partial<Transaccion>): Transaccion {
  return {
    id_transaccion: `TRX_${n++}`,
    id_espacio: 'ESP_TELCOM',
    id_usuario: 'USR_a',
    id_cuenta: 'CTA_banco',
    id_categoria: 'CAT_comb',
    tipo: 'gasto',
    monto: 100,
    descripcion: '',
    fecha: '2026-10-05',
    hora: '10:00:00',
    ubicacion: '',
    notas: '',
    rev: 1,
    origen: 'app',
    eliminado: false,
    fecha_creacion: '',
    fecha_modificacion: '',
    sync_status: 'synced',
    ...p,
  };
}

function cat(id: string, nombre: string, grupo: string, tipo: 'gasto' | 'ingreso' = 'gasto'): Categoria {
  return { id_categoria: id, id_espacio: 'ESP_TELCOM', nombre, tipo, icono: '•', color: '#000', es_sistema: true, grupo, orden: 0, activo: true };
}

function deuda(p: Partial<Deuda>): Deuda {
  return {
    id_deuda: `DDA_${n++}`,
    id_espacio: 'ESP_TELCOM',
    id_usuario: '',
    tipo: 'debo',
    persona: '',
    monto_original: 100,
    monto_pendiente: 100,
    descripcion: '',
    fecha_creacion: '',
    fecha_vencimiento: '2026-10-15',
    estado: 'pendiente',
    recordatorio: true,
    notas: '',
    rev: 1,
    origen: 'app',
    eliminado: false,
    sync_status: 'synced',
    ...p,
  };
}

function trabajador(id: string, nombre: string, activo = true): Trabajador {
  return {
    id_trabajador: id,
    id_espacio: 'ESP_TELCOM',
    nombre,
    documento: '',
    tipo_vinculo: 'planilla',
    cargo: '',
    proyecto: '',
    sueldo_base: 1500,
    pension: '',
    fecha_ingreso: '',
    fecha_fin: '',
    id_usuario: '',
    activo,
    notas: '',
    fecha_creacion: '',
    fecha_modificacion: '',
  };
}

const CATEGORIAS = [
  cat('CAT_comb', 'Combustible', 'operativos'),
  cat('CAT_sueldo', 'Sueldos y honorarios', 'personal'),
  cat('CAT_adel', 'Adelantos', 'personal'),
  cat('CAT_fact', 'Servicios facturados', 'ingresos', 'ingreso'),
];

const USUARIOS = [
  { id_usuario: 'USR_a', nombre: 'Ana' },
  { id_usuario: 'USR_b', nombre: 'Luis' },
] as Usuario[];

describe('mesAnterior', () => {
  it('cruza el año hacia atrás', () => {
    expect(mesAnterior(1, 2026)).toEqual({ mes: 12, anio: 2025 });
    expect(mesAnterior(3, 2026, 3)).toEqual({ mes: 12, anio: 2025 });
    expect(mesAnterior(10, 2026, 2)).toEqual({ mes: 8, anio: 2026 });
  });
});

describe('resumenPorPersona', () => {
  it('suma por usuario, ordena por gasto y marca la categoría principal', () => {
    const filas = [
      trx({ id_usuario: 'USR_a', monto: 100 }),
      trx({ id_usuario: 'USR_b', monto: 250, id_categoria: 'CAT_sueldo' }),
      trx({ id_usuario: 'USR_b', monto: 50 }),
      trx({ id_usuario: 'USR_a', tipo: 'ingreso', monto: 900, id_categoria: 'CAT_fact' }),
    ];
    const r = resumenPorPersona(filas, USUARIOS, CATEGORIAS);
    expect(r.map((p) => p.nombre)).toEqual(['Luis', 'Ana']);
    expect(r[0].gastos).toBe(300);
    expect(r[0].proporcion).toBeCloseTo(0.75);
    expect(r[0].categoria_principal?.nombre).toBe('Sueldos y honorarios');
    expect(r[1].ingresos).toBe(900);
  });

  it('agrupa los movimientos sin usuario conocido como "Sin asignar"', () => {
    const r = resumenPorPersona([trx({ id_usuario: '' })], USUARIOS, CATEGORIAS);
    expect(r[0].nombre).toBe('Sin asignar');
  });
});

describe('variacionesPorCategoria', () => {
  const historia = [
    trx({ fecha: '2026-07-10', monto: 300 }),
    trx({ fecha: '2026-08-10', monto: 300 }),
    trx({ fecha: '2026-09-10', monto: 300 }),
  ];

  it('compara un mes cerrado contra el promedio de los 3 anteriores', () => {
    const v = variacionesPorCategoria([...historia, trx({ fecha: '2026-10-10', monto: 450 })], CATEGORIAS, 10, 2026);
    expect(v[0].promedio).toBe(300);
    expect(v[0].variacion).toBeCloseTo(0.5);
  });

  it('prorratea el promedio en el mes en curso', () => {
    // A mitad de mes, 150 gastados es exactamente el ritmo de siempre.
    const v = variacionesPorCategoria([...historia, trx({ fecha: '2026-10-10', monto: 150 })], CATEGORIAS, 10, 2026, 0.5);
    expect(v[0].esperado).toBe(150);
    expect(v[0].variacion).toBeCloseTo(0);
  });

  it('cuenta los meses sin gasto como cero y no inventa variación sin historia', () => {
    const conHueco = variacionesPorCategoria([trx({ fecha: '2026-09-10', monto: 300 })], CATEGORIAS, 10, 2026);
    expect(conHueco[0].promedio).toBe(100);
    const nueva = variacionesPorCategoria([trx({ fecha: '2026-10-10' })], CATEGORIAS, 10, 2026);
    expect(nueva[0].variacion).toBeNull();
  });

  it('ignora lo que es más viejo que la ventana base', () => {
    const v = variacionesPorCategoria([trx({ fecha: '2026-06-10', monto: 999 })], CATEGORIAS, 10, 2026);
    expect(v).toHaveLength(0);
  });
});

describe('calcularIndicadores', () => {
  it('calcula costo de personal sobre ingresos y los pagos de personal sin trabajador', () => {
    const delMes = [
      trx({ tipo: 'ingreso', monto: 10000, id_categoria: 'CAT_fact' }),
      trx({ monto: 3000, id_categoria: 'CAT_sueldo', id_trabajador: 'TRB_1' }),
      trx({ monto: 500, id_categoria: 'CAT_adel' }),
      trx({ monto: 1500 }),
    ];
    const i = calcularIndicadores(delMes, CATEGORIAS, [], 10, 2026);
    expect(i.costo_personal).toBe(3500);
    expect(i.ratio_personal).toBeCloseTo(0.35);
    expect(i.tasa_ahorro).toBeCloseTo(0.5);
    expect(i.personal_sin_asignar).toEqual({ cantidad: 1, total: 500 });
    expect(i.gasto_por_grupo[0]).toMatchObject({ grupo: 'personal', total: 3500 });
  });

  it('sin ingresos no divide por cero', () => {
    const i = calcularIndicadores([trx({})], CATEGORIAS, [], 10, 2026);
    expect(i.tasa_ahorro).toBeNull();
    expect(i.ratio_personal).toBeNull();
  });

  it('en un espacio sin grupo personal no reporta ratio', () => {
    const familia = [cat('CAT_x', 'Comida', '')];
    const i = calcularIndicadores([trx({ tipo: 'ingreso', id_categoria: 'CAT_x' })], familia, [], 10, 2026);
    expect(i.ratio_personal).toBeNull();
  });

  it('suma solo las obligaciones que vencen en el mes', () => {
    const deudas = [
      deuda({ descripcion: 'Obligación mensual: Alquiler', monto_original: 1800, monto_pendiente: 0 }),
      deuda({ descripcion: 'Obligación mensual: EsSalud', monto_original: 600, monto_pendiente: 600 }),
      deuda({ descripcion: 'Obligación mensual: Alquiler', fecha_vencimiento: '2026-09-05' }),
      deuda({ descripcion: 'Préstamo de un amigo' }),
    ];
    const i = calcularIndicadores([], CATEGORIAS, deudas, 10, 2026);
    expect(i.obligaciones).toEqual({ cantidad: 2, estimado: 2400, pagado: 1800, pendiente: 600 });
  });
});

describe('fichasTrabajadores', () => {
  it('acumula el año hasta el mes elegido, sin contar meses posteriores', () => {
    const pagos = [
      trx({ id_trabajador: 'TRB_1', id_categoria: 'CAT_sueldo', monto: 1500, fecha: '2026-08-30' }),
      trx({ id_trabajador: 'TRB_1', id_categoria: 'CAT_sueldo', monto: 1500, fecha: '2026-09-30' }),
      trx({ id_trabajador: 'TRB_1', id_categoria: 'CAT_adel', monto: 200, fecha: '2026-09-12' }),
      trx({ id_trabajador: 'TRB_1', id_categoria: 'CAT_sueldo', monto: 1500, fecha: '2026-10-30' }),
      trx({ id_trabajador: 'TRB_1', monto: 1500, fecha: '2025-12-30' }),
    ];
    const [f] = fichasTrabajadores([trabajador('TRB_1', 'Pedro')], pagos, [], CATEGORIAS, 9, 2026, '2026-10-14');
    expect(f.total_mes).toBe(1700);
    expect(f.total_anio).toBe(3200);
    expect(f.meses_con_pago).toBe(2);
    expect(f.ultimo_pago).toBe('2026-09-30');
    expect(f.por_categoria[0]).toMatchObject({ nombre: 'Sueldos y honorarios', total: 3000 });
  });

  it('separa adelantos por descontar de pagos programados por hacer', () => {
    const deudas = [
      deuda({ tipo: 'me_deben', id_trabajador: 'TRB_1', monto_pendiente: 200 }),
      deuda({ tipo: 'debo', id_trabajador: 'TRB_1', monto_pendiente: 1500 }),
      deuda({ tipo: 'debo', id_trabajador: 'TRB_1', monto_pendiente: 0, estado: 'pagada' }),
    ];
    const [f] = fichasTrabajadores([trabajador('TRB_1', 'Pedro')], [], deudas, CATEGORIAS, 10, 2026, '2026-10-14');
    expect(f.adelantos_pendientes).toBe(200);
    expect(f.por_pagar).toBe(1500);
  });

  it('oculta a los dados de baja que no tienen nada este año', () => {
    const fichas = fichasTrabajadores(
      [trabajador('TRB_1', 'Activo'), trabajador('TRB_2', 'Se fue', false)],
      [],
      [],
      CATEGORIAS,
      10,
      2026,
      '2026-10-14',
    );
    expect(fichas.map((f) => f.trabajador.nombre)).toEqual(['Activo']);
  });
});

describe('vencimiento de contrato', () => {
  it('cuenta los días hasta fecha_fin y deja null si es indefinido', () => {
    const conFin = { ...trabajador('TRB_1', 'Pedro'), fecha_fin: '2026-12-31' };
    const [a, b] = fichasTrabajadores([conFin, trabajador('TRB_2', 'Rosa')], [], [], CATEGORIAS, 10, 2026, '2026-10-14')
      .sort((x, y) => x.trabajador.nombre.localeCompare(y.trabajador.nombre));
    expect(a.dias_para_fin).toBe(78);
    expect(b.dias_para_fin).toBeNull();
  });
});

describe('saldosPorCuenta', () => {
  it('parte del saldo inicial y separa el neto del mes', () => {
    const cuenta = { id_cuenta: 'CTA_banco', saldo_inicial: 1000, activo: true } as Cuenta;
    const filas = [
      trx({ monto: 200, fecha: '2026-09-01' }),
      trx({ tipo: 'ingreso', monto: 500, id_categoria: 'CAT_fact' }),
      trx({ monto: 100 }),
    ];
    const [s] = saldosPorCuenta([cuenta], filas, 10, 2026);
    expect(s.saldo).toBe(1200);
    expect(s.neto_mes).toBe(400);
  });
});

describe('generarCsv', () => {
  it('escapa comas y comillas y resuelve nombres', () => {
    const csv = generarCsv(
      [trx({ descripcion: 'Grifo "Primax", Comas', id_trabajador: 'TRB_1' })],
      {
        categorias: CATEGORIAS,
        cuentas: [{ id_cuenta: 'CTA_banco', nombre: 'BCP' } as Cuenta],
        usuarios: USUARIOS,
        trabajadores: [trabajador('TRB_1', 'Pedro')],
      },
    );
    const [cabecera, fila] = csv.split('\r\n');
    expect(cabecera.split(',')).toContain('trabajador');
    expect(fila).toBe('2026-10-05,gasto,Operativos,Combustible,100.00,"Grifo ""Primax"", Comas",Ana,Pedro,BCP,app');
  });
});

describe('serieMensual', () => {
  const cuentas = [
    { id_cuenta: 'A', saldo_inicial: 1000, activo: true },
    { id_cuenta: 'B', saldo_inicial: 500, activo: true },
    { id_cuenta: 'C', saldo_inicial: 9999, activo: false },
  ] as unknown as Cuenta[];

  it('arrastra la historia previa y acumula mes a mes, cruzando el año', () => {
    const txs = [
      trx({ tipo: 'ingreso', monto: 300, fecha: '2025-11-10' }), // previo a la ventana
      trx({ tipo: 'ingreso', monto: 1000, fecha: '2025-12-01' }),
      trx({ tipo: 'gasto', monto: 400, fecha: '2025-12-15' }),
      trx({ tipo: 'gasto', monto: 100, fecha: '2026-02-03' }),
    ];
    const s = serieMensual(cuentas, txs, 3, 2, 2026);
    expect(s.map((p) => [p.mes, p.anio])).toEqual([[12, 2025], [1, 2026], [2, 2026]]);
    expect(s[0]).toMatchObject({ ingresos: 1000, gastos: 400, neto: 600, saldo_acumulado: 1500 + 300 + 600 });
    expect(s[1]).toMatchObject({ ingresos: 0, gastos: 0, neto: 0, saldo_acumulado: 2400 });
    expect(s[2]).toMatchObject({ gastos: 100, neto: -100, saldo_acumulado: 2300 });
  });

  it('sin movimientos devuelve el saldo inicial plano', () => {
    const s = serieMensual(cuentas, [], 2, 1, 2026);
    expect(s.map((p) => p.saldo_acumulado)).toEqual([1500, 1500]);
  });
});
