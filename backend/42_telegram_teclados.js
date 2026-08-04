// ==================== TECLADOS INLINE DE TELEGRAM ====================
//
// Dueño: agente de BOT DE TELEGRAM + GEMINI. Solo construye estructuras
// `inline_keyboard` para la Bot API. No llama a Sheets ni a la red: funciones
// puras sobre los datos que le pasan 40_telegram.js.
//
// callback_data compacto: Telegram limita a 64 bytes. En vez de mandar el
// id completo (p.ej. "USR_ab12cd34ef56"), se manda el índice del elemento
// dentro del array que se mostró (p.ej. "u:0", "c:3"). Quien llama es
// responsable de guardar ese array en el estado del chat (CacheService)
// para poder traducir el índice de vuelta al id real.

/**
 * Reparte una lista de botones en filas de `porFila` (default 2).
 */
function tgTecladoDesdeBotones(botones, porFila) {
  const n = porFila || 2;
  const filas = [];
  for (let i = 0; i < botones.length; i += n) {
    filas.push(botones.slice(i, i + n));
  }
  return { inline_keyboard: filas };
}

/**
 * Botones "¿De quién es este gasto?": un botón por usuario activo, en el
 * mismo orden que el array `usuarios` (quien llama guarda ese orden en
 * `usuarios_idx` del estado para poder resolver el índice del callback_data).
 */
function tgTecladoUsuarios(usuarios) {
  const botones = usuarios.map((u, i) => ({ text: u.nombre, callback_data: 'u:' + i }));
  return tgTecladoDesdeBotones(botones, 2);
}

/**
 * Botones "¿A qué espacio pertenece?" (Familia / Telcom, contrato §0.3): un
 * botón por espacio activo, en el mismo orden que el array `espacios` (quien
 * llama guarda ese orden en `espacios_idx` del estado). Dos espacios entran
 * en una sola fila; si algún día hubiera más, tgTecladoDesdeBotones ya reparte.
 */
function tgTecladoEspacios(espacios) {
  const botones = espacios.map((e, i) => ({ text: (e.icono ? e.icono + ' ' : '') + e.nombre, callback_data: 'e:' + i }));
  return tgTecladoDesdeBotones(botones, 2);
}

/**
 * Mueve la categoría sugerida por Gemini al principio de la lista, sin
 * duplicarla. Se usa ANTES de generar tanto el array de índices
 * (categorias_idx) como el teclado, para que ambos queden en el mismo orden.
 */
function tgOrdenarCategoriasConSugerida(categorias, idCategoriaSugerida) {
  if (!idCategoriaSugerida) return categorias.slice();
  let sugerida = null;
  const resto = [];
  categorias.forEach((c) => {
    if (!sugerida && c.id_categoria === idCategoriaSugerida) {
      sugerida = c;
    } else {
      resto.push(c);
    }
  });
  return sugerida ? [sugerida].concat(resto) : categorias.slice();
}

/**
 * Botones de categoría. `categoriasOrdenadas` debe ser el mismo array (y
 * mismo orden) que se usó para construir `categorias_idx` en el estado,
 * típicamente el resultado de tgOrdenarCategoriasConSugerida.
 */
function tgTecladoCategorias(categoriasOrdenadas, idCategoriaSugerida) {
  const botones = categoriasOrdenadas.map((c, i) => {
    const esSugerida = !!idCategoriaSugerida && c.id_categoria === idCategoriaSugerida;
    const icono = c.icono ? c.icono + ' ' : '';
    const texto = (esSugerida ? '✓ ' : '') + icono + c.nombre;
    return { text: texto, callback_data: 'c:' + i };
  });
  return tgTecladoDesdeBotones(botones, 2);
}

/**
 * Botones de confirmación final del registro.
 */
function tgTecladoConfirmacion() {
  return {
    inline_keyboard: [
      [{ text: '✅ Guardar', callback_data: 'ok' }],
      [{ text: '✏️ Corregir monto', callback_data: 'edit' }],
      [{ text: '❌ Cancelar', callback_data: 'cancel' }]
    ]
  };
}

/**
 * Botones [✅ Aprobar] [❌ Rechazar] de una solicitud de dinero (contrato §4-bis),
 * en el aviso al propietario. callback_data lleva el id_solicitud completo
 * (no un índice): a diferencia de usuario/categoría/espacio, este botón vive
 * en un mensaje aparte, no dentro de la máquina de estados del chat, así que
 * no hay un array en el estado contra el cual resolver un índice.
 * 'sap:' + id ronda los ~16-20 bytes con los prefijos de id actuales (p.ej.
 * SOL_ab12cd34): muy por debajo del límite de 64 bytes de Telegram.
 */
function tgTecladoSolicitud(idSolicitud) {
  return {
    inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: 'sap:' + idSolicitud },
      { text: '❌ Rechazar', callback_data: 'srj:' + idSolicitud }
    ]]
  };
}
