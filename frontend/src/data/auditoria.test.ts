import { describe, expect, it } from 'vitest';
import type { Categoria, Deuda, Trabajador, Transaccion } from './types';
import { auditar, type EntradaAuditoria } from './auditoria';

let n = 0;
const trx = (p: Partial<Transaccion>): Transaccion =>
  ({ id_transaccion: `T${n++}`, tipo: 'gasto', monto: 50, fecha: '2026-10-05', id_categoria: 'C_comb', id_cuenta: 'A', id_trabajador: '', eliminado: false, ...p }) as Transaccion;
const deuda = (p: Partial<Deuda>): Deuda =>
  ({ id_deuda: `D${n++}`, tipo: 'debo', persona: 'SUNAT', estado: 'pendiente', monto_pendiente: 100, monto_original: 100, descripcion: '', notas: '', fecha_vencimiento: '2026-10-20', ...p }) as Deuda;
const trabajador = (p: Partial<Trabajador>): Trabajador =>
  ({ id_trabajador: `W${n++}`, nombre: 'Rosa', activo: true, tipo_vinculo: 'planilla', pension: 'ONP', sueldo_base: 1500, documento: '1', fecha_fin: '', notas: '', ...p }) as Trabajador;
const CATS = [
  { id_categoria: 'C_comb', nombre: 'Combustible', grupo: 'operativos' },
  { id_categoria: 'C_sueldo', nombre: 'Sueldos', grupo: 'personal' },
] as Categoria[];

const base = (p: Partial<EntradaAuditoria> = {}): EntradaAuditoria => ({
  transacciones: [], categorias: CATS, deudas: [], trabajadores: [], obligaciones: [],
  pendientesSync: 0, conflictos: 0, mes: 10, anio: 2026, hoy: '2026-10-14', ...p,
});
const ids = (e: EntradaAuditoria) => auditar(e).map((x) => x.id);

describe('auditar', () => {
  it('un libro limpio no da hallazgos', () => {
    expect(auditar(base({ trabajadores: [trabajador({})] }))).toEqual([]);
  });

  it('detecta pagos vencidos y lo que vence esta semana, con montos', () => {
    const r = auditar(base({ deudas: [deuda({ fecha_vencimiento: '2026-10-12', monto_pendiente: 63 }), deuda({ fecha_vencimiento: '2026-10-18' }), deuda({ fecha_vencimiento: '2026-12-01' })] }));
    expect(r[0]).toMatchObject({ id: 'vencidas-debo', severidad: 'alta', monto: 63 });
    expect(r.find((x) => x.id === 'vence-semana')?.monto).toBe(100);
  });

  it('avisa contratos por vencer y vencidos, y datos de planilla incompletos', () => {
    const r = ids(base({ trabajadores: [trabajador({ fecha_fin: '2026-11-19' }), trabajador({ fecha_fin: '2026-10-01', pension: '', sueldo_base: 0, documento: '' })] }));
    expect(r.filter((x) => x.startsWith('contrato-'))).toHaveLength(2);
    expect(r).toEqual(expect.arrayContaining(['sin-pension', 'sin-sueldo', 'sin-dni']));
  });

  it('marca [VERIFICAR], personal sin trabajador, duplicados y atípicos', () => {
    const historia = Array.from({ length: 6 }, (_, i) => trx({ fecha: `2026-0${i + 3}-10`, monto: 50 }));
    const r = ids(base({
      trabajadores: [trabajador({ notas: '[VERIFICAR] sueldo' })],
      transacciones: [
        ...historia,
        trx({ id_categoria: 'C_sueldo', monto: 900 }),
        trx({ monto: 80, fecha: '2026-10-07' }), trx({ monto: 80, fecha: '2026-10-07' }),
        trx({ monto: 500, fecha: '2026-10-09' }),
      ],
    }));
    expect(r).toEqual(expect.arrayContaining(['verificar', 'personal-sin-trabajador', 'duplicados', 'atipicos']));
  });

  it('lee los controles del tablero y prioriza lo grave primero', () => {
    const tablero = { mes: 10, anio: 2026, hojas: [{ id: 'Planilla', titulo: 'Planilla del mes', descripcion: '', columnas: [], filas: [{ etiqueta: 'Diferencia (debe ser 0)', tipo: 'control', celdas: [{ v: null }, { v: null }, { v: 120 }] }] }] } as unknown as EntradaAuditoria['tablero'];
    const r = auditar(base({ tablero, pendientesSync: 2 }));
    expect(r[0]).toMatchObject({ id: 'control-Planilla', severidad: 'alta', monto: 120 });
    expect(r[r.length - 1].id).toBe('pendientes-sync');
  });
});
