import { describe, expect, it } from 'vitest';
import type { Trabajador } from './types';
import { interpretarCsvTrabajadores, interpretarMonto, normalizarFecha } from './importarTrabajadores';

const CABECERA = 'nombre,documento,tipo_vinculo,cargo,proyecto,sueldo_base,pension,fecha_ingreso,fecha_fin,notas';

describe('normalizarFecha', () => {
  it('acepta ISO y dd/mm/aaaa, rechaza fechas imposibles', () => {
    expect(normalizarFecha('2026-07-01')).toBe('2026-07-01');
    expect(normalizarFecha('1/7/2026')).toBe('2026-07-01');
    expect(normalizarFecha('')).toBe('');
    expect(normalizarFecha('31/02/2026')).toBeNull();
    expect(normalizarFecha('julio')).toBeNull();
  });
});

describe('interpretarMonto', () => {
  it('distingue separador de miles del decimal', () => {
    expect(interpretarMonto('S/ 2,200')).toBe(2200);
    expect(interpretarMonto('3.500')).toBe(3500);
    expect(interpretarMonto('1500,50')).toBe(1500.5);
    expect(interpretarMonto('45.45')).toBe(45.45);
    expect(interpretarMonto('1.234,5')).toBe(1234.5);
    expect(interpretarMonto('1,234.50')).toBe(1234.5);
    expect(interpretarMonto('')).toBe(0);
  });
});

describe('interpretarCsvTrabajadores', () => {
  it('lee filas válidas con comillas y normaliza vínculo, sueldo y fechas', () => {
    const csv = `${CABECERA}\n"Pérez, Ana",12345678,Planilla,Analista,CP-026,"S/ 2,200",ONP,01/07/2026,31/12/2026,\nLuis Rojas,,locación,Apoyo,CP-026,1000,,20/08/2026,19/11/2026,por jornada`;
    const r = interpretarCsvTrabajadores(csv, []);
    expect(r.errores).toEqual([]);
    expect(r.filas[0].datos).toMatchObject({
      nombre: 'Pérez, Ana',
      tipo_vinculo: 'planilla',
      sueldo_base: 2200,
      fecha_ingreso: '2026-07-01',
      fecha_fin: '2026-12-31',
    });
    expect(r.filas[1].datos.tipo_vinculo).toBe('honorarios');
  });

  it('cruza por documento para corregir en vez de duplicar', () => {
    const existente = { id_trabajador: 'TRB_1', documento: '12345678' } as Trabajador;
    const r = interpretarCsvTrabajadores(`${CABECERA}\nAna Pérez,12345678,planilla,,,,,,,`, [existente]);
    expect(r.filas[0].id_existente).toBe('TRB_1');
  });

  it('acepta punto y coma como separador (Excel en español)', () => {
    const r = interpretarCsvTrabajadores('nombre;tipo_vinculo;sueldo_base\nAna;planilla;1500,50', []);
    expect(r.filas[0].datos.sueldo_base).toBe(1500.5);
  });

  it('reporta errores por línea sin frenar el resto', () => {
    const csv = `${CABECERA}\n,1,planilla\nBeto,2,contratista\nCarla,3,planilla,,,,,,30/02/2026,\nDana,4,planilla\nDana bis,4,planilla`;
    const r = interpretarCsvTrabajadores(csv, []);
    expect(r.filas.map((f) => f.datos.nombre)).toEqual(['Dana']);
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3, 4, 6]);
  });

  it('exige las columnas mínimas', () => {
    const r = interpretarCsvTrabajadores('nombre,cargo\nAna,Analista', []);
    expect(r.filas).toHaveLength(0);
    expect(r.errores[0].mensaje).toContain('tipo_vinculo');
  });
});
