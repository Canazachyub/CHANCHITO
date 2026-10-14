import type { Celda, Formato, Tablero } from './tablero';

const FORMATO_NUMERO: Record<Formato, string | undefined> = {
  moneda: '"S/" #,##0.00;[Red]-"S/" #,##0.00',
  pct: '0.0%',
  meses: '0.0 "meses"',
  fecha: 'dd/mm/yyyy',
  entero: '0',
  texto: undefined,
};

/**
 * 'yyyy-MM-dd' → Date. Se arma en UTC a medianoche porque exceljs convierte con getTime(): con una
 * fecha local en una zona al este de UTC el serial caería un día antes.
 */
function aFecha(ymd: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : ymd;
}

function valorExcel(c: Celda): Date | number | string | null {
  if (c.v === null) return null;
  return c.fmt === 'fecha' && typeof c.v === 'string' ? aFecha(c.v) : c.v;
}

/** Genera el .xlsx del tablero (una hoja por Hoja, con las mismas fórmulas) y lo descarga. */
export async function exportarTableroXlsx(t: Tablero, nombreArchivo: string): Promise<void> {
  // Carga diferida: exceljs pesa mucho y solo se necesita al exportar.
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Chanchito';
  libro.calcProperties.fullCalcOnLoad = true;

  for (const hoja of t.hojas) {
    // El nombre de la pestaña es el id: las fórmulas ('Caja!E4') lo usan como referencia.
    const ws = libro.addWorksheet(hoja.id, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });

    const cabecera = ws.addRow(hoja.columnas);
    cabecera.font = { bold: true };
    cabecera.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
      c.border = { bottom: { style: 'thin' } };
    });

    for (const fila of hoja.filas) {
      const row = ws.addRow([fila.etiqueta]);
      fila.celdas.forEach((celda, k) => {
        const cell = row.getCell(k + 2);
        const valor = valorExcel(celda);
        if (celda.f) {
          cell.value = { formula: celda.f, result: (valor ?? undefined) as number | string | Date | undefined };
        } else if (valor !== null) {
          cell.value = valor;
        }
        const nf = celda.fmt && FORMATO_NUMERO[celda.fmt];
        if (nf) cell.numFmt = nf;
        if (celda.fmt && celda.fmt !== 'texto') cell.alignment = { horizontal: 'right' };
      });

      if (fila.tipo === 'subtotal' || fila.tipo === 'total') {
        row.font = { bold: true };
        row.eachCell({ includeEmpty: true }, (c) => {
          c.border = { top: { style: fila.tipo === 'total' ? 'double' : 'thin' } };
        });
      } else if (fila.tipo === 'control') {
        row.font = { italic: true, color: { argb: 'FF6B7280' } };
      } else if (fila.tipo === 'seccion') {
        row.font = { bold: true };
        for (let c = 1; c <= hoja.columnas.length; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
        }
      }
    }

    ws.getColumn(1).width = 34;
    for (let c = 2; c <= hoja.columnas.length; c++) {
      ws.getColumn(c).width = hoja.id === 'Resumen' && c === 3 ? 70 : 18;
    }
  }

  const buffer = await libro.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
