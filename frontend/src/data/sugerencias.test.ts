import { describe, expect, it } from 'vitest';
import type { Categoria, Deuda, ObligacionMensual, Trabajador, Transaccion } from './types';
import { normalizar, porPagarPronto, sugerenciasPara, type EntradaSugerencias } from './sugerencias';

const cat = (id: string, nombre: string, grupo = ''): Categoria =>
  ({ id_categoria: id, nombre, grupo, tipo: 'gasto', activo: true }) as Categoria;
let n = 0;
const trx = (p: Partial<Transaccion>): Transaccion =>
  ({ id_transaccion: `T${n++}`, tipo: 'gasto', monto: 50, fecha: '2026-09-10', id_categoria: 'SERV', descripcion: '', eliminado: false, ...p }) as Transaccion;
const deuda = (p: Partial<Deuda>): Deuda =>
  ({ id_deuda: `D${n++}`, tipo: 'debo', estado: 'pendiente', monto_pendiente: 100, persona: 'X', descripcion: '', fecha_vencimiento: '2026-10-20', eliminado: false, ...p }) as Deuda;

const SERV = cat('SERV', 'Servicios');
const base = (p: Partial<EntradaSugerencias> = {}): EntradaSugerencias => ({
  categorias: [SERV], transacciones: [], deudas: [], obligaciones: [], trabajadores: [], hoy: '2026-10-14', ...p,
});

describe('normalizar', () => {
  it('quita tildes, mayúsculas y espacios de más', () => {
    expect(normalizar('  Educación  Física ')).toBe('educacion fisica');
  });
});

describe('sugerenciasPara', () => {
  it('sin historia propone plantillas de la categoría', () => {
    const s = sugerenciasPara(base());
    expect(s.map((x) => x.titulo)).toEqual(['Luz', 'Agua', 'Internet', 'Celular', 'Gas', 'Cable']);
    expect(s.every((x) => x.tipo === 'plantilla' && x.monto === undefined)).toBe(true);
  });

  it('pone primero lo que vence, enlazado a la deuda, y no lo repite como plantilla', () => {
    const obligaciones = [{ concepto: 'Internet', id_categoria: 'SERV', eliminado: false } as ObligacionMensual];
    const deudas = [
      deuda({ persona: 'Internet', descripcion: 'Obligación mensual: Internet', monto_pendiente: 59.54, fecha_vencimiento: '2026-10-12' }),
      deuda({ persona: 'Lejana', descripcion: 'Obligación mensual: Internet', fecha_vencimiento: '2026-12-01' }),
    ];
    const s = sugerenciasPara(base({ obligaciones, deudas }));
    expect(s[0]).toMatchObject({ tipo: 'pagar', titulo: 'Internet', monto: 59.54, urgencia: 'vencido' });
    expect(s[0].detalle).toContain('venció hace 2 días');
    expect(s.filter((x) => x.titulo === 'Internet')).toHaveLength(1);
    expect(s.some((x) => x.titulo === 'Lejana')).toBe(false);
  });

  it('repite lo pagado antes con el último monto, ordenado por frecuencia', () => {
    const transacciones = [
      trx({ descripcion: 'Luz Electro', monto: 80, fecha: '2026-08-05' }),
      trx({ descripcion: 'luz electro', monto: 92.3, fecha: '2026-09-05' }),
      trx({ descripcion: 'Agua EPS', monto: 40, fecha: '2026-09-07' }),
      trx({ descripcion: 'Otra categoría', id_categoria: 'COMIDA' }),
    ];
    const s = sugerenciasPara(base({ transacciones }));
    expect(s[0]).toMatchObject({ tipo: 'repetir', titulo: 'luz electro', monto: 92.3 });
    expect(s[0].detalle).toContain('05/09');
    expect(s[1].titulo).toBe('Agua EPS');
    expect(s.some((x) => x.titulo === 'Otra categoría')).toBe(false);
  });

  it('en personal ofrece a cada trabajador activo con su sueldo base', () => {
    const sueldo = cat('SUELDO', 'Sueldos y honorarios', 'personal');
    const trabajadores = [
      { id_trabajador: 'W1', nombre: 'Rosa', cargo: 'Coordinadora', sueldo_base: 3500, activo: true },
      { id_trabajador: 'W2', nombre: 'Se fue', activo: false },
    ] as Trabajador[];
    const s = sugerenciasPara(base({ categorias: [sueldo], trabajadores }));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ tipo: 'trabajador', id_trabajador: 'W1', monto: 3500 });
  });

  it('las cuotas de préstamo aparecen en las categorías financieras', () => {
    const amort = cat('AMORT', 'Amortización de préstamos', 'financiero');
    const deudas = [deuda({ id_prestamo: 'P1', persona: 'BCP', nro_cuota: 3, monto_pendiente: 985.64, fecha_vencimiento: '2026-10-18' })];
    const s = sugerenciasPara(base({ categorias: [amort], deudas }));
    expect(s[0]).toMatchObject({ tipo: 'pagar', titulo: 'BCP · cuota 3', urgencia: 'pronto' });
  });

  it('asocia deudas sueltas por palabra clave: la multa SUNAT sale en Impuestos', () => {
    const imp = cat('IMP', 'Impuestos y SUNAT', 'impuestos');
    const deudas = [
      deuda({ persona: 'SUNAT', descripcion: 'Multa RM 113-002', monto_pendiente: 63, fecha_vencimiento: '2026-10-12' }),
      deuda({ persona: 'Ferretería', descripcion: 'Materiales' }),
    ];
    const s = sugerenciasPara(base({ categorias: [imp], deudas }));
    expect(s[0]).toMatchObject({ tipo: 'pagar', titulo: 'SUNAT', monto: 63, urgencia: 'vencido' });
    expect(s.some((x) => x.titulo === 'Ferretería')).toBe(false);
  });

  it('respeta el máximo', () => {
    expect(sugerenciasPara(base({ maximo: 2 }))).toHaveLength(2);
  });
});

describe('porPagarPronto', () => {
  it('incluye vencidas y próximas, excluye pagadas, cobros y lejanas', () => {
    const r = porPagarPronto(
      [
        deuda({ id_deuda: 'A', fecha_vencimiento: '2026-10-10' }),
        deuda({ id_deuda: 'B', fecha_vencimiento: '2026-10-18' }),
        deuda({ id_deuda: 'C', fecha_vencimiento: '2026-11-30' }),
        deuda({ id_deuda: 'D', estado: 'pagada', monto_pendiente: 0 }),
        deuda({ id_deuda: 'E', tipo: 'me_deben' }),
      ],
      '2026-10-14',
    );
    expect(r.map((x) => x.deuda.id_deuda)).toEqual(['A', 'B']);
    expect(r[0].dias).toBe(-4);
  });
});
