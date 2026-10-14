/**
 * Importación de trabajadores desde CSV — lógica PURA.
 *
 * Pensado para cargar de una vez la planilla que ya existe en otro lado (hoja de cálculo, notas)
 * y para corregirla después: si el DNI ya está, la fila actualiza a ese trabajador en vez de
 * duplicarlo. Por eso el documento es la clave de cruce, no el nombre (que se escribe de mil formas).
 */
import type { TipoVinculo, Trabajador } from './types';

export const COLUMNAS_CSV_TRABAJADORES = [
  'nombre',
  'documento',
  'tipo_vinculo',
  'cargo',
  'proyecto',
  'sueldo_base',
  'pension',
  'fecha_ingreso',
  'fecha_fin',
  'notas',
] as const;

export interface FilaTrabajadorCsv {
  nombre: string;
  documento: string;
  tipo_vinculo: TipoVinculo;
  cargo: string;
  proyecto: string;
  sueldo_base: number;
  pension: string;
  fecha_ingreso: string;
  fecha_fin: string;
  notas: string;
}

export interface ResultadoImportacion {
  /** Filas listas, con el id del trabajador existente si el documento ya estaba. */
  filas: Array<{ linea: number; datos: FilaTrabajadorCsv; id_existente: string | null }>;
  errores: Array<{ linea: number; mensaje: string }>;
}

/** Separa una línea CSV respetando comillas ("Pérez, Juan"). Acepta coma o punto y coma. */
function separarLinea(linea: string, separador: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      celdas.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  celdas.push(actual.trim());
  return celdas;
}

/** 'yyyy-MM-dd' o 'dd/MM/yyyy' → 'yyyy-MM-dd'. '' sigue siendo ''. null si no se entiende. */
export function normalizarFecha(valor: string): string | null {
  const v = valor.trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let anio: number, mes: number, dia: number;
  if (m) {
    [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * 'S/ 2,200' → 2200, '1500,50' → 1500.5, '1.234,5' → 1234.5. '' → 0. NaN si no es un monto.
 * Con un solo separador, tres dígitos detrás lo vuelven separador de miles: así se escriben los
 * sueldos en Perú, y leer "2,200" como 2.2 pagaría a alguien mil veces menos.
 */
export function interpretarMonto(valor: string): number {
  const limpio = valor.replace(/[^\d.,-]/g, '');
  if (!limpio) return 0;
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  let normalizado: string;
  if (ultimoPunto !== -1 && ultimaComa !== -1) {
    const decimal = ultimoPunto > ultimaComa ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    normalizado = limpio.split(miles).join('').replace(decimal, '.');
  } else {
    const sep = ultimoPunto !== -1 ? '.' : ultimaComa !== -1 ? ',' : '';
    const partes = sep ? limpio.split(sep) : [limpio];
    const esMiles = partes.length > 2 || (partes.length === 2 && partes[1].length === 3);
    normalizado = esMiles ? partes.join('') : partes.join('.');
  }
  return Number(normalizado);
}

function normalizarVinculo(valor: string): TipoVinculo | null {
  const v = valor.trim().toLowerCase();
  if (v === 'planilla') return 'planilla';
  // Locación de servicios y recibo por honorarios se pagan igual: contra recibo, sin planilla.
  if (['honorarios', 'locacion', 'locación', 'rh', 'recibo por honorarios'].includes(v)) return 'honorarios';
  return null;
}

export function interpretarCsvTrabajadores(texto: string, existentes: Trabajador[]): ResultadoImportacion {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const resultado: ResultadoImportacion = { filas: [], errores: [] };
  const primera = lineas.findIndex((l) => l.trim() !== '');
  if (primera === -1) {
    resultado.errores.push({ linea: 0, mensaje: 'El archivo está vacío.' });
    return resultado;
  }

  const separador = (lineas[primera].match(/;/g)?.length ?? 0) > (lineas[primera].match(/,/g)?.length ?? 0) ? ';' : ',';
  const cabecera = separarLinea(lineas[primera], separador).map((c) => c.toLowerCase());
  const faltan = ['nombre', 'tipo_vinculo'].filter((c) => !cabecera.includes(c));
  if (faltan.length) {
    resultado.errores.push({ linea: primera + 1, mensaje: `Faltan columnas: ${faltan.join(', ')}.` });
    return resultado;
  }

  const porDocumento = new Map(existentes.filter((t) => t.documento).map((t) => [t.documento, t.id_trabajador]));
  const vistos = new Set<string>();

  for (let i = primera + 1; i < lineas.length; i++) {
    if (!lineas[i].trim()) continue;
    const linea = i + 1;
    const celdas = separarLinea(lineas[i], separador);
    const valor = (col: string) => {
      const idx = cabecera.indexOf(col);
      return idx === -1 ? '' : celdas[idx] ?? '';
    };

    const nombre = valor('nombre');
    if (!nombre) {
      resultado.errores.push({ linea, mensaje: 'Falta el nombre.' });
      continue;
    }
    const tipo_vinculo = normalizarVinculo(valor('tipo_vinculo'));
    if (!tipo_vinculo) {
      resultado.errores.push({ linea, mensaje: `${nombre}: vínculo "${valor('tipo_vinculo')}" no es planilla ni honorarios.` });
      continue;
    }
    const sueldo_base = interpretarMonto(valor('sueldo_base'));
    if (!Number.isFinite(sueldo_base) || sueldo_base < 0) {
      resultado.errores.push({ linea, mensaje: `${nombre}: sueldo "${valor('sueldo_base')}" no es un monto válido.` });
      continue;
    }
    const fecha_ingreso = normalizarFecha(valor('fecha_ingreso'));
    const fecha_fin = normalizarFecha(valor('fecha_fin'));
    if (fecha_ingreso === null || fecha_fin === null) {
      resultado.errores.push({ linea, mensaje: `${nombre}: fecha inválida (usa dd/mm/aaaa o aaaa-mm-dd).` });
      continue;
    }

    const documento = valor('documento').replace(/\s/g, '');
    if (documento && vistos.has(documento)) {
      resultado.errores.push({ linea, mensaje: `${nombre}: el documento ${documento} se repite en el archivo.` });
      continue;
    }
    if (documento) vistos.add(documento);

    resultado.filas.push({
      linea,
      id_existente: documento ? porDocumento.get(documento) ?? null : null,
      datos: {
        nombre,
        documento,
        tipo_vinculo,
        cargo: valor('cargo'),
        proyecto: valor('proyecto'),
        sueldo_base,
        pension: valor('pension'),
        fecha_ingreso,
        fecha_fin,
        notas: valor('notas'),
      },
    });
  }

  return resultado;
}
