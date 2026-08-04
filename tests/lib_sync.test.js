/**
 * Tests de backend/lib_sync.js — la garantía normativa de docs/CONTRACT.md § 4 y
 * README § 11 ("prueba de conflicto de sincronización"): ninguna edición se pierde
 * en silencio. Control de revisiones simplificado inspirado en PouchDB `_rev`.
 *
 * Forma exacta del resultado de resolverOperacion — tomada literalmente del JSON
 * normativo de CONTRACT.md § 4 (bloque "resultados"), no inventada:
 *   - aplicado:  { estado: 'aplicado', id, rev }
 *   - conflicto: { estado: 'conflicto', id, version_servidor, version_cliente }
 *   - rechazado: { estado: 'rechazado', error, detalle }
 *
 * resolverOperacion es PURA y solo decide rev/conflicto — NO valida los datos
 * (monto, campos requeridos, etc.). Esa validación ocurre antes, en el endpoint
 * `sincronizar` (backend/30_sincronizar.js, fuera del alcance de esta suite),
 * usando lib_validacion.js — cubierto en tests/lib_validacion.test.js. Por eso
 * acá no se prueba "datos inválidos → rechazado" contra resolverOperacion: sería
 * probar un contrato que esa función no tiene.
 *
 * De igual forma, "eliminar marca eliminado sin borrar" es una garantía sobre lo
 * que escribe el endpoint (nunca `deleteRow`, siempre `eliminado = true`), no
 * sobre resolverOperacion en sí — que para 'eliminar' solo decide si el rev_base
 * coincide, igual que para 'editar'. Se prueba aquí que la decisión de rev para
 * 'eliminar' sigue exactamente la misma regla que 'editar'.
 */

let lib;
try {
  lib = require('../backend/lib_sync.js');
} catch (e) {
  lib = null;
}

const describeIfExists = lib ? describe : describe.skip;

if (!lib) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/lib_sync.test.js] backend/lib_sync.js todavía no existe — se omiten los tests. ' +
    'Ver CONTRACT.md § "Firmas obligatorias de la lógica pura".'
  );
}

describeIfExists('lib_sync', () => {
  describe('resolverOperacion — operación malformada', () => {
    test('sin tipo → rechazado CAMPO_REQUERIDO', () => {
      const r = lib.resolverOperacion({ op_id: 'op-x', id: 'TRX_1' }, null);
      expect(r.estado).toBe('rechazado');
      expect(r.error).toBe('CAMPO_REQUERIDO');
    });

    test('tipo desconocido → rechazado CAMPO_REQUERIDO', () => {
      const r = lib.resolverOperacion({ op_id: 'op-y', tipo: 'duplicar', id: 'TRX_1' }, null);
      expect(r.estado).toBe('rechazado');
      expect(r.error).toBe('CAMPO_REQUERIDO');
    });

    test('op null/undefined no revienta', () => {
      expect(() => lib.resolverOperacion(null, null)).not.toThrow();
      expect(lib.resolverOperacion(null, null).estado).toBe('rechazado');
    });
  });

  describe('siguienteRev', () => {
    test('sube en 1', () => {
      expect(lib.siguienteRev(1)).toBe(2);
      expect(lib.siguienteRev(5)).toBe(6);
    });

    test('desde 0 (o inválido) arranca en 1', () => {
      expect(lib.siguienteRev(0)).toBe(1);
    });
  });

  describe('resolverOperacion — editar con rev_base correcto', () => {
    const filaActual = {
      id_transaccion: 'TRX_ab12cd34',
      id_espacio: 'ESP_COMPARTIDO',
      id_usuario: 'USR_1',
      monto: 50,
      descripcion: 'Super',
      rev: 3,
      origen: 'app',
      eliminado: false,
      fecha_modificacion: '2026-08-01 10:00:00'
    };

    const op = {
      op_id: 'op-1',
      tipo: 'editar',
      entidad: 'transaccion',
      id: 'TRX_ab12cd34',
      rev_base: 3,
      datos: { monto: 60, descripcion: 'Super actualizado' }
    };

    test("rev_base igual al rev actual → 'aplicado' con rev+1", () => {
      const r = lib.resolverOperacion(op, filaActual);
      expect(r.estado).toBe('aplicado');
      expect(r.id).toBe('TRX_ab12cd34');
      expect(r.rev).toBe(4);
    });

    test('no muta la fila actual recibida (función pura)', () => {
      const copia = { ...filaActual };
      lib.resolverOperacion(op, filaActual);
      expect(filaActual).toEqual(copia);
    });

    test('no muta los datos de la operación recibida (función pura)', () => {
      const copiaOp = JSON.parse(JSON.stringify(op));
      lib.resolverOperacion(op, filaActual);
      expect(op).toEqual(copiaOp);
    });
  });

  describe('resolverOperacion — editar con rev_base distinto (conflicto)', () => {
    const filaActual = {
      id_transaccion: 'TRX_ab12cd34',
      monto: 999,
      descripcion: 'Editado por otro dispositivo',
      rev: 5,
      eliminado: false
    };

    const op = {
      op_id: 'op-2',
      tipo: 'editar',
      entidad: 'transaccion',
      id: 'TRX_ab12cd34',
      rev_base: 3, // el cliente partió de rev 3, el servidor ya va en rev 5
      datos: { monto: 60, descripcion: 'Mi versión offline' }
    };

    test("rev_base distinto al actual → 'conflicto', no aplicado", () => {
      const r = lib.resolverOperacion(op, filaActual);
      expect(r.estado).toBe('conflicto');
    });

    test('el conflicto trae AMBAS versiones completas: la del servidor y la del cliente', () => {
      const r = lib.resolverOperacion(op, filaActual);
      expect(r.version_servidor).toEqual(filaActual);
      expect(r.version_cliente).toEqual(op.datos);
    });

    test('no sobrescribe: la fila actual no se modifica y el resultado no trae rev de "aplicado"', () => {
      const copia = { ...filaActual };
      const r = lib.resolverOperacion(op, filaActual);
      expect(filaActual).toEqual(copia);
      expect(r.rev).toBeUndefined();
      expect(r.estado).not.toBe('aplicado');
    });
  });

  describe('resolverOperacion — crear', () => {
    test('crear un id nuevo (filaActual null) → aplicado, rev 1', () => {
      const op = {
        op_id: 'op-3',
        tipo: 'crear',
        entidad: 'transaccion',
        id: 'TRX_nuevo123',
        rev_base: null,
        datos: { id_espacio: 'ESP_COMPARTIDO', id_usuario: 'USR_1', monto: 20, tipo: 'gasto' }
      };
      const r = lib.resolverOperacion(op, null);
      expect(r.estado).toBe('aplicado');
      expect(r.id).toBe('TRX_nuevo123');
      expect(r.rev).toBe(1);
    });

    test('crear sobre un id que ya existe → conflicto, no se sobrescribe el existente', () => {
      const filaActual = {
        id_transaccion: 'TRX_yaexiste',
        monto: 100,
        rev: 1,
        eliminado: false
      };
      const op = {
        op_id: 'op-4',
        tipo: 'crear',
        entidad: 'transaccion',
        id: 'TRX_yaexiste',
        rev_base: null,
        datos: { monto: 999 }
      };
      const r = lib.resolverOperacion(op, filaActual);
      expect(r.estado).toBe('conflicto');
      expect(r.version_servidor).toEqual(filaActual);
      expect(r.version_cliente).toEqual(op.datos);
      // El registro existente no debe verse alterado.
      expect(filaActual.monto).toBe(100);
    });
  });

  describe('resolverOperacion — editar/eliminar un id inexistente', () => {
    test("editar con filaActual null → rechazado NO_ENCONTRADO", () => {
      const op = {
        op_id: 'op-5',
        tipo: 'editar',
        entidad: 'transaccion',
        id: 'TRX_no_existe',
        rev_base: 1,
        datos: { monto: 10 }
      };
      const r = lib.resolverOperacion(op, null);
      expect(r.estado).toBe('rechazado');
      expect(r.error).toBe('NO_ENCONTRADO');
    });

    test("eliminar con filaActual null → rechazado NO_ENCONTRADO", () => {
      const op = {
        op_id: 'op-5b',
        tipo: 'eliminar',
        entidad: 'transaccion',
        id: 'TRX_no_existe',
        rev_base: 1,
        datos: {}
      };
      const r = lib.resolverOperacion(op, null);
      expect(r.estado).toBe('rechazado');
      expect(r.error).toBe('NO_ENCONTRADO');
    });
  });

  describe('resolverOperacion — eliminar (misma regla de rev que editar)', () => {
    test('rev_base correcto → aplicado con rev+1 (el endpoint es quien marca eliminado=true, sin deleteRow)', () => {
      const filaActual = { id_transaccion: 'TRX_ab12cd34', monto: 50, rev: 2, eliminado: false };
      const op = {
        op_id: 'op-8',
        tipo: 'eliminar',
        entidad: 'transaccion',
        id: 'TRX_ab12cd34',
        rev_base: 2,
        datos: {}
      };
      const r = lib.resolverOperacion(op, filaActual);
      expect(r.estado).toBe('aplicado');
      expect(r.rev).toBe(3);
    });

    test('rev_base desactualizado → conflicto, no se marca eliminado', () => {
      const filaActual = { id_transaccion: 'TRX_x', monto: 10, rev: 5, eliminado: false };
      const op = {
        op_id: 'op-9',
        tipo: 'eliminar',
        entidad: 'transaccion',
        id: 'TRX_x',
        rev_base: 2,
        datos: {}
      };
      const r = lib.resolverOperacion(op, filaActual);
      expect(r.estado).toBe('conflicto');
      expect(filaActual.eliminado).toBe(false);
    });
  });

  describe('filtrarCambiosDesde', () => {
    const filas = [
      { id: 'A', fecha_modificacion: '2026-08-01 09:00:00', eliminado: false },
      { id: 'B', fecha_modificacion: '2026-08-01 11:00:00', eliminado: false },
      { id: 'C', fecha_modificacion: '2026-08-02 08:00:00', eliminado: true }, // borrado lógico posterior
      { id: 'D', fecha_modificacion: '2026-07-30 00:00:00', eliminado: false }
    ];

    test('desde null devuelve todas las filas', () => {
      const r = lib.filtrarCambiosDesde(filas, null);
      expect(r.length).toBe(4);
    });

    test('desde una fecha devuelve solo las filas posteriores (estrictamente >)', () => {
      const r = lib.filtrarCambiosDesde(filas, '2026-08-01 10:00:00');
      const ids = r.map((f) => f.id).sort();
      expect(ids).toEqual(['B', 'C']);
    });

    test('incluye los eliminado=true entre los cambios posteriores (el cliente debe enterarse del borrado)', () => {
      const r = lib.filtrarCambiosDesde(filas, '2026-08-01 10:00:00');
      const borrado = r.find((f) => f.id === 'C');
      expect(borrado).toBeDefined();
      expect(borrado.eliminado).toBe(true);
    });

    test('una fecha posterior a todo devuelve array vacío', () => {
      const r = lib.filtrarCambiosDesde(filas, '2030-01-01 00:00:00');
      expect(r.length).toBe(0);
    });

    test('lista de filas vacía siempre devuelve vacío', () => {
      expect(lib.filtrarCambiosDesde([], null)).toEqual([]);
      expect(lib.filtrarCambiosDesde([], '2026-01-01 00:00:00')).toEqual([]);
    });
  });

  describe('filtrarCambiosDesde — aplicado sobre Deudas y Presupuestos (docs/CONTRACT.md § 2, fecha_modificacion ⬅)', () => {
    // Antes del fix, Deudas/Presupuestos no tenían fecha_modificacion y
    // 30_sincronizar.js las devolvía completas siempre. filtrarCambiosDesde es
    // genérica (ya lo era), así que basta con probarla contra filas con la
    // forma real de esas dos hojas para confirmar que el filtro incremental
    // funciona igual que para transacciones.
    const deudas = [
      { id_deuda: 'DDA_1', monto_pendiente: 100, estado: 'pendiente', rev: 1, eliminado: false, fecha_modificacion: '2026-07-01 00:00:00' },
      { id_deuda: 'DDA_2', monto_pendiente: 0, estado: 'pagada', rev: 2, eliminado: false, fecha_modificacion: '2026-08-02 09:00:00' },
      { id_deuda: 'DDA_3', monto_pendiente: 50, estado: 'pendiente', rev: 3, eliminado: true, fecha_modificacion: '2026-08-02 10:00:00' }
    ];

    test('desde null devuelve las tres deudas', () => {
      expect(lib.filtrarCambiosDesde(deudas, null).length).toBe(3);
    });

    test('desde una fecha intermedia solo trae las deudas modificadas después, incluida la eliminada', () => {
      const r = lib.filtrarCambiosDesde(deudas, '2026-08-01 00:00:00');
      const ids = r.map((d) => d.id_deuda).sort();
      expect(ids).toEqual(['DDA_2', 'DDA_3']);
    });

    const presupuestos = [
      { id_presupuesto: 'PRE_1', monto_limite: 500, rev: 1, eliminado: false, fecha_modificacion: '2026-07-15 00:00:00' },
      { id_presupuesto: 'PRE_2', monto_limite: 200, rev: 2, eliminado: false, fecha_modificacion: '2026-08-02 12:00:00' }
    ];

    test('lo mismo aplica a Presupuestos', () => {
      const r = lib.filtrarCambiosDesde(presupuestos, '2026-08-01 00:00:00');
      expect(r.map((p) => p.id_presupuesto)).toEqual(['PRE_2']);
    });
  });
});
