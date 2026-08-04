/**
 * Tests de backend/lib_filas.js — construirFilaOrdenada, la lógica pura detrás
 * de anexarFila (backend/02_util.js).
 *
 * Cubre el bug de corrupción de datos confirmado en producción: en una hoja
 * `Usuarios` migrada, `_asegurarColumnas` (91_setup.js) agregó
 * `telegram_chat_id` y `rol_global` AL FINAL en vez de en las posiciones que
 * tienen en ESQUEMA_COLUMNAS (00_config.js). Un `appendRow([...])` armado en
 * el orden del esquema escribía cada valor corrido una columna: 'propietario'
 * terminaba en `fecha_registro`, la fecha en `activo`, etc. `anexarFila` debe
 * escribir siempre en el orden REAL de encabezados de la hoja.
 */

let lib;
try {
  lib = require('../backend/lib_filas.js');
} catch (e) {
  lib = null;
}

const describeIfExists = lib ? describe : describe.skip;

if (!lib) {
  // eslint-disable-next-line no-console
  console.warn(
    '[tests/lib_filas.test.js] backend/lib_filas.js todavía no existe — se omiten los tests.'
  );
}

describeIfExists('lib_filas.construirFilaOrdenada', () => {
  test('orden del esquema y orden real de la hoja coinciden → mismo resultado, en orden', () => {
    const headersReales = ['id_usuario', 'email', 'nombre', 'foto_perfil', 'google_id', 'telegram_chat_id', 'rol_global', 'moneda_principal', 'fecha_registro', 'ultima_sesion', 'activo'];
    const datos = {
      id_usuario: 'USR_1',
      email: 'a@b.com',
      nombre: 'Ana',
      foto_perfil: '',
      google_id: '',
      telegram_chat_id: '',
      rol_global: 'propietario',
      moneda_principal: 'PEN',
      fecha_registro: '2026-08-02 10:00:00',
      ultima_sesion: '',
      activo: true
    };

    const r = lib.construirFilaOrdenada(headersReales, datos);

    expect(r.valores).toEqual([
      'USR_1', 'a@b.com', 'Ana', '', '', '', 'propietario', 'PEN', '2026-08-02 10:00:00', '', true
    ]);
    expect(r.clavesDesconocidas).toEqual([]);
  });

  test('caso real que rompió producción: hoja migrada con telegram_chat_id y rol_global agregados AL FINAL — cada valor cae en su columna, no la del esquema', () => {
    // Orden real de la hoja Usuarios del usuario (docs del bug): las dos
    // columnas nuevas quedaron al final, no en la posición 6/7 del esquema.
    const headersReales = ['id_usuario', 'email', 'nombre', 'foto_perfil', 'google_id', 'moneda_principal', 'fecha_registro', 'ultima_sesion', 'activo', 'telegram_chat_id', 'rol_global'];
    const datos = {
      id_usuario: 'USR_2',
      email: 'propietario@chanchito.com',
      nombre: 'Propietario',
      foto_perfil: '',
      google_id: '',
      telegram_chat_id: '123456',
      rol_global: 'propietario',
      moneda_principal: 'PEN',
      fecha_registro: '2026-08-02 10:00:00',
      ultima_sesion: '',
      activo: true
    };

    const r = lib.construirFilaOrdenada(headersReales, datos);

    // Cada posición del array corresponde a headersReales[i], no al orden del
    // esquema: 'propietario' NO debe caer en fecha_registro, 'PEN' no debe
    // caer en ultima_sesion, la fecha no debe caer en activo.
    expect(r.valores[headersReales.indexOf('fecha_registro')]).toBe('2026-08-02 10:00:00');
    expect(r.valores[headersReales.indexOf('activo')]).toBe(true);
    expect(r.valores[headersReales.indexOf('ultima_sesion')]).toBe('');
    expect(r.valores[headersReales.indexOf('telegram_chat_id')]).toBe('123456');
    expect(r.valores[headersReales.indexOf('rol_global')]).toBe('propietario');
    expect(r.valores[headersReales.indexOf('moneda_principal')]).toBe('PEN');
    expect(r.clavesDesconocidas).toEqual([]);
  });

  test('columna del esquema que la hoja todavía no tiene → el valor se ignora, no revienta', () => {
    // La hoja no tiene "rol_global" todavía (recién agregando la columna
    // vía migración), pero `datos` la trae como cualquier campo del esquema.
    const headersReales = ['id_usuario', 'email', 'nombre'];
    const datos = { id_usuario: 'USR_3', email: 'c@d.com', nombre: 'Caro', rol_global: 'miembro' };

    expect(() => lib.construirFilaOrdenada(headersReales, datos)).not.toThrow();
    const r = lib.construirFilaOrdenada(headersReales, datos);

    expect(r.valores).toEqual(['USR_3', 'c@d.com', 'Caro']);
    expect(r.clavesDesconocidas).toEqual(['rol_global']);
  });

  test('clave en datos que no existe como encabezado → no revienta y se reporta en clavesDesconocidas', () => {
    const headersReales = ['id_etiqueta', 'id_espacio', 'nombre', 'color'];
    const datos = { id_etiqueta: 'ETQ_1', id_espacio: 'ESP_FAMILIA', nombre: 'Urgente', color: '#FF0000', tipeo_incorrecto: 'x' };

    const r = lib.construirFilaOrdenada(headersReales, datos);

    expect(r.valores).toEqual(['ETQ_1', 'ESP_FAMILIA', 'Urgente', '#FF0000']);
    expect(r.clavesDesconocidas).toEqual(['tipeo_incorrecto']);
  });

  test('columna real sin valor presente en datos → se escribe como string vacío, no undefined', () => {
    const headersReales = ['id_transaccion', 'notas'];
    const r = lib.construirFilaOrdenada(headersReales, { id_transaccion: 'TRX_1' });

    expect(r.valores).toEqual(['TRX_1', '']);
  });

  test('headersReales vacío (hoja recién creada sin encabezados) → valores vacío, no revienta', () => {
    const r = lib.construirFilaOrdenada([], { id_usuario: 'USR_1' });

    expect(r.valores).toEqual([]);
    expect(r.clavesDesconocidas).toEqual(['id_usuario']);
  });

  test('datos con un valor falsy legítimo (false, 0, "") se preserva — no se confunde con "ausente"', () => {
    const headersReales = ['activo', 'orden', 'notas'];
    const r = lib.construirFilaOrdenada(headersReales, { activo: false, orden: 0, notas: '' });

    expect(r.valores).toEqual([false, 0, '']);
    expect(r.clavesDesconocidas).toEqual([]);
  });

  test('headersReales null/undefined → se trata como [], no revienta', () => {
    expect(() => lib.construirFilaOrdenada(null, { id: 'x' })).not.toThrow();
    expect(() => lib.construirFilaOrdenada(undefined, { id: 'x' })).not.toThrow();

    const r = lib.construirFilaOrdenada(undefined, { id: 'x' });
    expect(r.valores).toEqual([]);
    expect(r.clavesDesconocidas).toEqual(['id']);
  });

  test('datos null/undefined → se trata como {}, no revienta, todo sale vacío', () => {
    const headersReales = ['id_usuario', 'nombre'];

    expect(() => lib.construirFilaOrdenada(headersReales, null)).not.toThrow();
    expect(() => lib.construirFilaOrdenada(headersReales, undefined)).not.toThrow();

    const r = lib.construirFilaOrdenada(headersReales, null);
    expect(r.valores).toEqual(['', '']);
    expect(r.clavesDesconocidas).toEqual([]);
  });
});
