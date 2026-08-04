// ==================== BOT DE TELEGRAM ====================
//
// Dueño: agente de BOT DE TELEGRAM + GEMINI (backend/40_telegram.js,
// 41_gemini.js, 42_telegram_teclados.js, 50_triggers.js, docs/BOT.md).
//
// Punto de entrada: manejarTelegramWebhook(e), llamado por backend/01_router.js
// para action=telegramWebhook. SIEMPRE devuelve 200 con {ok:true} — si
// devolviéramos error, Telegram reintenta el mismo update y se duplican
// los gastos. Los errores se reportan a Sentry y se avisan por chat, nunca
// vía código HTTP de error.
//
// Máquina de estados por chat_id en CacheService (clave tg_estado_<chat_id>,
// TTL 15 min). Nunca variables globales: Apps Script no las conserva entre
// invocaciones del webhook.
//
// DOS ESPACIOS (docs/CONTRACT.md §0.3): ya no existe un único espacio
// compartido. Todo registro pregunta primero el espacio (Familia/Telcom),
// ANTES que el usuario, porque la categoría y la cuenta dependen de él —
// un gasto de la empresa en el libro de la casa es el peor error posible de
// este bot. `ESPACIO_COMPARTIDO_ID` (backend/00_config.js) desapareció como
// constante: este archivo NUNCA la usa. Los espacios reales se leen vía
// getEspacios() (backend/11_espacios.js, contrato §3); ver tgObtenerEspacios()
// más abajo para el fallback mientras esa función no esté disponible todavía.
//
// Dependencias externas reales (backend/00_config.js, 02_util.js, lib_*.js,
// y los dominios ya escritos por el resto del equipo — nombres verificados
// contra el código ya presente en /backend al momento de escribir esto; las
// firmas de dominio están migrando en paralelo a recibir id_espacio, así que
// se llaman siempre con el id de espacio elegido en el bot, nunca con una
// constante fija):
//   getProp, jsonResponse, getSheet, getAllData, generateId,
//   fechaHoraActual, fechaActual, findRow(sheet, valor, columnaIndex=0), withLock,
//   SHEETS.{USUARIOS,TRANSACCIONES,DEUDAS,CATEGORIAS,CUENTAS,EVIDENCIAS,NOTIFICACIONES},
//   crearTransaccion, subirEvidencia, getCategorias(idEspacio, tipo),
//   getResumenMensual(idEspacio, mes, anio), getDeudas(idEspacio, tipo, estado),
//   getEspacios(), validarMonto, sanearTexto, diasHastaVencimiento, reportarSentry.
// Solicitudes de dinero (§4-bis) y obligaciones (§4-ter) — backend/23_solicitudes.js
// y backend/24_obligaciones.js, contrato entre agentes, nombres fijos (§3):
//   crearSolicitud(p, u), getSolicitudes(p), responderSolicitud(p, u), getObligaciones(p).
// Al momento de escribir este archivo esos dos .js todavía no existían en el
// repo (otro agente los está creando en paralelo): se llaman según la firma
// documentada en el contrato, no contra código leído. Si terminan difiriendo,
// el try/catch de cada comando lo reporta a Sentry y avisa al chat sin tumbar
// el webhook — nunca hace que manejarTelegramWebhook devuelva error.
//
// crearTransaccion y subirEvidencia ya hacen su propio withLock() internamente:
// nunca los llamamos desde dentro de OTRO withLock() para no anidar locks.
// De este mismo agente: geminiLeerVoucher (41_gemini.js),
//   tgTeclado*/tgOrdenarCategoriasConSugerida (42_telegram_teclados.js).

const TG_ESTADO_TTL_SEGUNDOS = 900; // 15 minutos, por contrato §5
const TG_ULTIMO_ESPACIO_TTL_SEGUNDOS = 21600; // 6h: tope real de CacheService en Apps Script
const TG_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Teclado vacío: se pasa explícito cuando se edita un mensaje que YA tenía
// botones, para que desaparezcan. editMessageText de Telegram NO limpia el
// reply_markup si se omite el parámetro: lo deja tal cual estaba. Omitirlo acá
// es como dejar un botón que, tocado de nuevo, dispara una segunda respuesta
// sobre algo que ya se resolvió (el caso real: aprobar dos veces una solicitud).
const TG_TECLADO_VACIO = { inline_keyboard: [] };

// Fallback fijo (contrato §0.3) mientras getEspacios() (backend/11_espacios.js)
// no esté disponible o no devuelva filas: así el bot sigue funcionando aunque
// el agente de espacios todavía no haya terminado su parte. Ver tgObtenerEspacios().
const TG_ESPACIOS_FALLBACK = [
  { id_espacio: 'ESP_FAMILIA', nombre: 'Familia', icono: '🏠' },
  { id_espacio: 'ESP_TELCOM', nombre: 'Telcom', icono: '🏢' }
];

// ==================== ENTRADA DEL WEBHOOK ====================

function manejarTelegramWebhook(e) {
  let chatId = null;
  try {
    if (!tgSecretoValido(e)) {
      return jsonResponse({ ok: true });
    }

    const update = tgParsearBody(e);
    if (!update) return jsonResponse({ ok: true });

    if (update.callback_query) {
      const cq = update.callback_query;
      chatId = cq.message && cq.message.chat && cq.message.chat.id;
      tgManejarCallbackQuery(cq);
    } else if (update.message) {
      chatId = update.message.chat && update.message.chat.id;
      tgManejarMensaje(update.message);
    }
    // Otros tipos de update (edited_message, my_chat_member, etc.) se ignoran.
  } catch (err) {
    reportarSentry(err, { origen: 'manejarTelegramWebhook', chat_id: chatId });
    if (chatId) {
      try {
        tgEnviarMensaje(chatId, 'Uy, algo falló de mi lado. Probá de nuevo en un momento.');
      } catch (err2) {
        // No hay nada más que hacer: no dejamos que esto tumbe la respuesta 200.
      }
    }
  }
  return jsonResponse({ ok: true });
}

/**
 * Apps Script (ContentService) no expone headers HTTP arbitrarios en doPost(e),
 * así que X-Telegram-Bot-Api-Secret-Token es inaccesible por más que Telegram lo
 * mande. El gate real es el parámetro `secreto` de la URL del webhook, que solo
 * conocen @BotFather y este script.
 *
 * Va TELEGRAM_WEBHOOK_SECRET y no SHARED_TOKEN a propósito: la URL del webhook
 * queda guardada en los servidores de Telegram, y no hay razón para dejar ahí el
 * token que abre el resto de la API. Si este secreto se filtra, se rota solo.
 *
 * Se sigue leyendo el header por si una versión futura de Apps Script lo expone.
 */
function tgSecretoValido(e) {
  const esperado = getProp('TELEGRAM_WEBHOOK_SECRET');
  if (!esperado) return false;

  const headerSecreto = tgObtenerHeaderSecreto(e);
  if (headerSecreto !== null) {
    return headerSecreto === esperado;
  }

  const secretoUrl = e && e.parameter ? e.parameter.secreto : null;
  return !!secretoUrl && secretoUrl === esperado;
}

function tgObtenerHeaderSecreto(e) {
  if (!e || !e.headers) return null;
  const h = e.headers;
  return h['X-Telegram-Bot-Api-Secret-Token'] || h['x-telegram-bot-api-secret-token'] || null;
}

function tgParsearBody(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return null;
    return JSON.parse(e.postData.contents);
  } catch (err) {
    reportarSentry(err, { origen: 'tgParsearBody' });
    return null;
  }
}

// ==================== DESPACHO DE MENSAJES ====================

function tgManejarMensaje(message) {
  const chatId = message.chat.id;

  if (message.photo && message.photo.length) {
    tgManejarFoto(chatId, message.photo);
    return;
  }

  const texto = message.text;
  if (!texto) {
    tgEnviarMensaje(chatId, 'Mandame el monto y la descripción (ej: /gasto 45.90 almuerzo) o una foto del comprobante.');
    return;
  }

  const limpio = texto.trim();

  if (limpio.charAt(0) === '/') {
    tgManejarComando(chatId, limpio);
    return;
  }

  // No es un comando: puede ser la respuesta a un estado pendiente.
  const estado = tgLeerEstado(chatId);
  if (estado && estado.estado === 'esperando_email') {
    tgProcesarEmail(chatId, limpio);
    return;
  }
  if (estado && estado.estado === 'esperando_monto_corregido') {
    tgProcesarMontoCorregido(chatId, limpio, estado);
    return;
  }

  tgEnviarMensaje(chatId, 'No entendí. Usá /gasto, /ingreso, /balance, /deudas, /solicitar, /solicitudes, /obligaciones, o mandame una foto del comprobante. /cancelar para empezar de nuevo.');
}

function tgManejarComando(chatId, texto) {
  const partes = texto.split(/\s+/);
  const cmd = partes[0].split('@')[0].toLowerCase();
  const args = texto.slice(partes[0].length).trim();

  switch (cmd) {
    case '/start':
      tgComandoStart(chatId);
      break;
    case '/gasto':
      tgComandoRegistro(chatId, args, 'gasto');
      break;
    case '/ingreso':
      tgComandoRegistro(chatId, args, 'ingreso');
      break;
    case '/balance':
      tgComandoBalance(chatId);
      break;
    case '/deudas':
      tgComandoDeudas(chatId);
      break;
    case '/solicitar':
      tgComandoSolicitar(chatId, args);
      break;
    case '/solicitudes':
      tgComandoSolicitudes(chatId);
      break;
    case '/obligaciones':
      tgComandoObligaciones(chatId);
      break;
    case '/agregar':
      tgComandoAgregar(chatId, args);
      break;
    case '/quitar':
      tgComandoQuitar(chatId, args);
      break;
    case '/cancelar':
      tgComandoCancelar(chatId);
      break;
    default:
      tgEnviarMensaje(chatId, 'No conozco ese comando. Probá /start, /gasto, /ingreso, /balance, /deudas, /solicitar, /solicitudes, /obligaciones o /cancelar.');
  }
}

// ==================== USUARIOS: BÚSQUEDA Y GUARDIAS ====================

function tgBuscarUsuarioPorChatId(chatId) {
  const usuarios = getAllData(getSheet(SHEETS.USUARIOS));
  for (let i = 0; i < usuarios.length; i++) {
    if (String(usuarios[i].telegram_chat_id) === String(chatId) && usuarios[i].activo) {
      return usuarios[i];
    }
  }
  return null;
}

function tgBuscarUsuarioPorEmail(email) {
  const normalizado = String(email).trim().toLowerCase();
  const usuarios = getAllData(getSheet(SHEETS.USUARIOS));
  for (let i = 0; i < usuarios.length; i++) {
    if (String(usuarios[i].email).trim().toLowerCase() === normalizado) {
      return usuarios[i];
    }
  }
  return null;
}

function tgUsuariosActivos() {
  return getAllData(getSheet(SHEETS.USUARIOS)).filter((u) => u.activo);
}

function tgEsPropietario(chatId) {
  const usuario = tgBuscarUsuarioPorChatId(chatId);
  return !!(usuario && usuario.rol_global === 'propietario');
}

/** Devuelve el usuario vinculado o null (y ya avisó al chat). */
function tgRequiereUsuario(chatId) {
  const usuario = tgBuscarUsuarioPorChatId(chatId);
  if (!usuario) {
    tgEnviarMensaje(chatId, 'Primero vinculá tu cuenta con /start.');
    return null;
  }
  return usuario;
}

function tgActualizarCampoUsuario(idUsuario, campo, valor) {
  const sheet = getSheet(SHEETS.USUARIOS);
  const row = findRow(sheet, idUsuario, 0);
  if (row > 0) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const col = headers.indexOf(campo);
    if (col >= 0) sheet.getRange(row, col + 1).setValue(valor);
  }
}

// ==================== /start Y VINCULACIÓN ====================

function tgComandoStart(chatId) {
  const usuario = tgBuscarUsuarioPorChatId(chatId);
  if (usuario) {
    tgBorrarEstado(chatId);
    tgEnviarMensaje(chatId, 'Hola ' + usuario.nombre + '. Ya estás vinculado. Mandame una foto del comprobante, o usá /gasto, /ingreso, /balance, /deudas, /solicitar, /solicitudes, /obligaciones.');
    return;
  }
  tgGuardarEstado(chatId, { estado: 'esperando_email' });
  tgEnviarMensaje(chatId, 'Hola. Para vincular tu cuenta, mandame el email con el que te dio de alta el administrador.');
}

function tgProcesarEmail(chatId, texto) {
  const email = sanearTexto(texto, 200);
  const usuario = tgBuscarUsuarioPorEmail(email);

  if (!usuario || !usuario.activo) {
    tgEnviarMensaje(chatId, 'Ese email no está autorizado. Pedile acceso al administrador. Si te equivocaste al tipear, mandalo de nuevo.');
    return; // deja esperando_email activo para reintentar
  }

  withLock(() => tgActualizarCampoUsuario(usuario.id_usuario, 'telegram_chat_id', String(chatId)));
  tgBorrarEstado(chatId);
  tgEnviarMensaje(chatId, 'Listo, ' + usuario.nombre + '. Quedaste vinculado. Mandame una foto del comprobante, o usá /gasto, /ingreso, /balance, /deudas, /solicitar, /solicitudes, /obligaciones.');
}

// ==================== ESPACIOS (Familia / Telcom, contrato §0.3) ====================
// Nunca se asume el espacio en silencio: todo flujo que escribe pide elegirlo
// y confirmarlo con un toque, aunque se le muestre primero el último usado.

/**
 * Lee los espacios reales vía getEspacios() (backend/11_espacios.js, contrato §3).
 * Si esa función todavía no existe (el agente de espacios no terminó) o no
 * devuelve filas activas, cae al fallback fijo de dos espacios del contrato.
 * Deliberadamente no reporta a Sentry en el catch: durante el desarrollo en
 * paralelo, que getEspacios() no exista todavía es un estado esperado, no un
 * error real del sistema en producción.
 */
function tgObtenerEspacios() {
  let resultado = null;
  try {
    resultado = getEspacios();
  } catch (err) {
    resultado = null;
  }
  const espacios = tgDesempaquetarLista(resultado, 'espacios').filter((e) => e.activo !== false);
  return espacios.length ? espacios : TG_ESPACIOS_FALLBACK;
}

function tgEspacioPorId(espacios, idEspacio) {
  return espacios.filter((e) => e.id_espacio === idEspacio)[0] || null;
}

/** Pone el último espacio usado por este chat primero en la lista (igual se pide confirmar). */
function tgOrdenarEspacios(espacios, idUltimo) {
  if (!idUltimo) return espacios.slice();
  const ultimo = tgEspacioPorId(espacios, idUltimo);
  if (!ultimo) return espacios.slice();
  const resto = espacios.filter((e) => e.id_espacio !== idUltimo);
  return [ultimo].concat(resto);
}

// ==================== /gasto Y /ingreso (TEXTO LIBRE) ====================

function tgComandoRegistro(chatId, args, tipo) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;

  if (!args) {
    tgEnviarMensaje(chatId, 'Uso: /' + tipo + ' <monto> <descripción>. Ejemplo: /' + tipo + ' 45.90 almuerzo');
    return;
  }

  const posEspacio = args.indexOf(' ');
  const montoTexto = posEspacio === -1 ? args : args.slice(0, posEspacio);
  const descripcion = posEspacio === -1 ? '' : args.slice(posEspacio + 1).trim();

  const validacion = validarMonto(montoTexto);
  if (!validacion.valido) {
    tgEnviarMensaje(chatId, 'No entendí el monto. Usá: /' + tipo + ' <monto> <descripción>. Ejemplo: /' + tipo + ' 45.90 almuerzo');
    return;
  }

  const borrador = {
    tipo: tipo,
    monto: validacion.valor,
    descripcion: sanearTexto(descripcion, 200) || (tipo === 'gasto' ? 'Gasto' : 'Ingreso'),
    comercio: '',
    fecha: fechaActual(),
    categoria_sugerida: null,
    categoria_sugerida_nombre: null,
    confianza: null,
    origen: 'bot_texto'
  };

  tgIniciarSeleccionEspacio(chatId, borrador, null);
}

// ==================== /balance Y /deudas (piden espacio primero) ====================

function tgComandoBalance(chatId) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;
  tgPedirEspacioParaAccion(chatId, 'balance');
}

function tgComandoDeudas(chatId) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;
  tgPedirEspacioParaAccion(chatId, 'deudas');
}

function tgPedirEspacioParaAccion(chatId, accion) {
  const espacios = tgObtenerEspacios();
  const ultimo = tgLeerUltimoEspacio(chatId);
  const ordenados = tgOrdenarEspacios(espacios, ultimo);

  const estado = {
    estado: 'esperando_espacio_accion',
    accion: accion,
    espacios_idx: ordenados.map((e) => e.id_espacio)
  };

  const teclado = tgTecladoEspacios(ordenados);
  const pregunta = accion === 'balance' ? '¿Balance de qué espacio?' : '¿Deudas de qué espacio?';

  const enviado = tgEnviarMensaje(chatId, pregunta, teclado);
  const messageId = tgIdDeMensajeEnviado(enviado);
  if (messageId) estado.mensaje_id = messageId;
  tgGuardarEstado(chatId, estado);
}

function tgProcesarSeleccionEspacioAccion(chatId, estado, idxStr) {
  const idx = parseInt(idxStr, 10);
  const idEspacio = estado.espacios_idx && estado.espacios_idx[idx];
  const espacios = tgObtenerEspacios();
  const espacioMeta = tgEspacioPorId(espacios, idEspacio);
  const messageId = estado.mensaje_id;

  if (!idEspacio || !espacioMeta) {
    tgEditarMensaje(chatId, messageId, 'No reconozco esa selección. Empezá de nuevo.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  tgGuardarUltimoEspacio(chatId, idEspacio);
  tgBorrarEstado(chatId);

  if (estado.accion === 'balance') {
    tgEjecutarBalance(chatId, idEspacio, espacioMeta, messageId);
  } else {
    tgEjecutarDeudas(chatId, idEspacio, espacioMeta, messageId);
  }
}

function tgEjecutarBalance(chatId, idEspacio, espacioMeta, messageId) {
  const hoy = new Date();
  const mes = hoy.getMonth() + 1;
  const anio = hoy.getFullYear();

  let resultado;
  try {
    resultado = getResumenMensual(idEspacio, mes, anio);
  } catch (err) {
    reportarSentry(err, { origen: 'tgComandoBalance', chat_id: chatId });
    tgEditarMensaje(chatId, messageId, 'No pude calcular el balance ahora. Probá de nuevo en un momento.', TG_TECLADO_VACIO);
    return;
  }

  const resumen = tgDesempaquetar(resultado, 'resumen');
  if (!resumen) {
    tgEditarMensaje(chatId, messageId, 'No hay datos de balance para este mes todavía.', TG_TECLADO_VACIO);
    return;
  }

  const texto = espacioMeta.icono + ' ' + espacioMeta.nombre + '\n📊 Balance de ' + tgNombreMes(mes) + ' ' + anio + '\n' +
    'Ingresos: ' + tgFormatoMonto(resumen.total_ingresos) + '\n' +
    'Gastos: ' + tgFormatoMonto(resumen.total_gastos) + '\n' +
    'Saldo: ' + tgFormatoMonto(resumen.saldo);

  tgEditarMensaje(chatId, messageId, texto, TG_TECLADO_VACIO);
}

function tgNombreMes(mes) {
  return TG_MESES[mes - 1] || String(mes);
}

// Desempaqueta resultados de estilo { success, data: {...} } o { success, resumen: {...} }
// o el objeto plano directo, sin asumir una única convención de la capa de dominio.
function tgDesempaquetar(resultado, clave) {
  if (!resultado) return null;
  if (resultado[clave]) return resultado[clave];
  if (resultado.data && resultado.data[clave]) return resultado.data[clave];
  if (resultado.data && typeof resultado.data === 'object') return resultado.data;
  if (resultado.total_ingresos !== undefined || resultado.total_gastos !== undefined || resultado.saldo !== undefined) {
    return resultado;
  }
  return null;
}

function tgDesempaquetarLista(resultado, clave) {
  if (!resultado) return [];
  if (Array.isArray(resultado)) return resultado;
  if (Array.isArray(resultado[clave])) return resultado[clave];
  if (resultado.data && Array.isArray(resultado.data[clave])) return resultado.data[clave];
  return [];
}

function tgEjecutarDeudas(chatId, idEspacio, espacioMeta, messageId) {
  let resultado;
  try {
    resultado = getDeudas(idEspacio, null, 'pendiente');
  } catch (err) {
    reportarSentry(err, { origen: 'tgComandoDeudas', chat_id: chatId });
    tgEditarMensaje(chatId, messageId, 'No pude consultar las deudas ahora. Probá de nuevo en un momento.', TG_TECLADO_VACIO);
    return;
  }

  const deudas = tgDesempaquetarLista(resultado, 'deudas');
  if (!deudas.length) {
    tgEditarMensaje(chatId, messageId, espacioMeta.icono + ' ' + espacioMeta.nombre + '\nNo hay deudas pendientes. 🎉', TG_TECLADO_VACIO);
    return;
  }

  const hoy = fechaActual();
  const lineas = deudas.map((d) => {
    const dias = diasHastaVencimiento(d.fecha_vencimiento, hoy);
    const venc = dias < 0 ? ('vencida hace ' + Math.abs(dias) + ' días') : ('vence en ' + dias + ' días');
    return '• ' + d.persona + ': ' + tgFormatoMonto(d.monto_pendiente) + ' (' + venc + ')';
  });

  tgEditarMensaje(chatId, messageId, espacioMeta.icono + ' ' + espacioMeta.nombre + '\n📋 Deudas pendientes:\n' + lineas.join('\n'), TG_TECLADO_VACIO);
}

// ==================== /solicitar Y /solicitudes (§4-bis) ====================
// Flujo deliberadamente corto: espacio → categoría → se crea de una vez y se
// avisa al propietario. No hay pantalla de confirmación extra (a diferencia
// del registro de gasto/ingreso): el contrato lo describe como corto a propósito.

function tgComandoSolicitar(chatId, args) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;

  if (!args) {
    tgEnviarMensaje(chatId, 'Uso: /solicitar <monto> <motivo>. Ejemplo: /solicitar 150 materiales para la obra');
    return;
  }

  const posEspacio = args.indexOf(' ');
  const montoTexto = posEspacio === -1 ? args : args.slice(0, posEspacio);
  const motivo = posEspacio === -1 ? '' : args.slice(posEspacio + 1).trim();

  const validacion = validarMonto(montoTexto);
  if (!validacion.valido || !motivo) {
    tgEnviarMensaje(chatId, 'Uso: /solicitar <monto> <motivo>. Ejemplo: /solicitar 150 materiales para la obra');
    return;
  }

  const borrador = {
    monto: validacion.valor,
    motivo: sanearTexto(motivo, 300)
  };

  tgIniciarSeleccionEspacioSolicitud(chatId, borrador, null);
}

function tgIniciarSeleccionEspacioSolicitud(chatId, borrador, mensajeIdAEditar) {
  const espacios = tgObtenerEspacios();
  const ultimo = tgLeerUltimoEspacio(chatId);
  const ordenados = tgOrdenarEspacios(espacios, ultimo);

  const estado = {
    estado: 'esperando_espacio_solicitud',
    borrador: borrador,
    espacios_idx: ordenados.map((e) => e.id_espacio)
  };

  const teclado = tgTecladoEspacios(ordenados);
  const texto = '💸 Solicitud: ' + tgFormatoMonto(borrador.monto) + ' — ' + borrador.motivo + '\n\n¿De qué espacio es?';

  if (mensajeIdAEditar) {
    estado.mensaje_id = mensajeIdAEditar;
    tgGuardarEstado(chatId, estado);
    tgEditarMensaje(chatId, mensajeIdAEditar, texto, teclado);
    return;
  }

  const enviado = tgEnviarMensaje(chatId, texto, teclado);
  const messageId = tgIdDeMensajeEnviado(enviado);
  if (messageId) estado.mensaje_id = messageId;
  tgGuardarEstado(chatId, estado);
}

function tgProcesarSeleccionEspacioSolicitud(chatId, estado, idxStr) {
  const idx = parseInt(idxStr, 10);
  const idEspacio = estado.espacios_idx && estado.espacios_idx[idx];
  const espacios = tgObtenerEspacios();
  const espacioMeta = tgEspacioPorId(espacios, idEspacio);

  if (!idEspacio || !espacioMeta) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No reconozco esa selección. Empezá de nuevo con /solicitar.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  estado.borrador.id_espacio = idEspacio;
  estado.borrador.espacio_nombre = espacioMeta.nombre;
  estado.borrador.espacio_icono = espacioMeta.icono || '';
  tgGuardarUltimoEspacio(chatId, idEspacio);

  const categorias = tgObtenerCategorias(idEspacio, 'gasto');
  if (!categorias.length) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No hay categorías de gasto configuradas en ' + espacioMeta.nombre + '. Avisale al administrador.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  estado.categorias_idx = categorias.map((c) => c.id_categoria);
  estado.estado = 'esperando_categoria_solicitud';
  tgGuardarEstado(chatId, estado);

  const teclado = tgTecladoCategorias(categorias, null);
  const texto = '💸 Solicitud: ' + tgFormatoMonto(estado.borrador.monto) + ' — ' + estado.borrador.motivo +
    '\nEspacio: ' + espacioMeta.icono + ' ' + espacioMeta.nombre + '\n\n¿Qué categoría es?';
  tgEditarMensaje(chatId, estado.mensaje_id, texto, teclado);
}

function tgProcesarSeleccionCategoriaSolicitud(chatId, estado, idxStr) {
  const idx = parseInt(idxStr, 10);
  const idCategoria = estado.categorias_idx && estado.categorias_idx[idx];
  if (!idCategoria) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No reconozco esa categoría. Empezá de nuevo con /solicitar.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  const categorias = tgObtenerCategorias(estado.borrador.id_espacio, 'gasto');
  const categoria = categorias.filter((c) => c.id_categoria === idCategoria)[0];

  estado.borrador.id_categoria = idCategoria;
  estado.borrador.categoria_nombre = categoria ? categoria.nombre : idCategoria;

  tgFinalizarSolicitud(chatId, estado);
}

// Único punto que escribe la solicitud. Nada se guarda antes de elegir la categoría.
function tgFinalizarSolicitud(chatId, estado) {
  const b = estado.borrador;
  const solicitante = tgBuscarUsuarioPorChatId(chatId);

  let resultado;
  try {
    resultado = crearSolicitud({
      id_espacio: b.id_espacio,
      monto: b.monto,
      motivo: b.motivo,
      id_categoria: b.id_categoria,
      origen: 'bot_texto'
    }, solicitante);
  } catch (err) {
    reportarSentry(err, { origen: 'tgFinalizarSolicitud', chat_id: chatId, borrador: b });
    tgBorrarEstado(chatId);
    tgEditarMensaje(chatId, estado.mensaje_id, 'No se pudo crear la solicitud. Probá de nuevo con /solicitar.', TG_TECLADO_VACIO);
    return;
  }

  tgBorrarEstado(chatId);

  if (!resultado || resultado.success === false) {
    const detalle = resultado && (resultado.detalle || resultado.error) ? (resultado.detalle || resultado.error) : 'error desconocido';
    tgEditarMensaje(chatId, estado.mensaje_id, 'No se pudo crear la solicitud: ' + detalle, TG_TECLADO_VACIO);
    return;
  }

  const solicitud = tgDesempaquetar(resultado, 'solicitud') || {};

  tgEditarMensaje(chatId, estado.mensaje_id,
    '✅ Solicitud enviada.\n' + b.espacio_icono + ' ' + b.espacio_nombre +
    '\nMonto: ' + tgFormatoMonto(b.monto) + '\nMotivo: ' + b.motivo +
    '\nCategoría: ' + b.categoria_nombre + '\n\nEsperá la aprobación del propietario.',
    TG_TECLADO_VACIO);

  tgAvisarPropietarioSolicitud(solicitud, b, solicitante);
}

function tgAvisarPropietarioSolicitud(solicitud, borrador, solicitante) {
  const idSolicitud = solicitud && (solicitud.id_solicitud || solicitud.id);
  if (!idSolicitud) return; // sin id no se puede armar el callback de aprobar/rechazar

  const propietario = tgUsuariosActivos().filter((u) => u.rol_global === 'propietario')[0];
  if (!propietario || !propietario.telegram_chat_id) return; // queda la notificación interna que ya creó crearSolicitud

  const texto = '💸 Nueva solicitud de dinero\n' +
    'De: ' + (solicitante ? solicitante.nombre : '') + '\n' +
    'Espacio: ' + borrador.espacio_icono + ' ' + borrador.espacio_nombre + '\n' +
    'Monto: ' + tgFormatoMonto(borrador.monto) + '\n' +
    'Motivo: ' + borrador.motivo + '\n' +
    'Categoría: ' + borrador.categoria_nombre;

  tgEnviarMensaje(propietario.telegram_chat_id, texto, tgTecladoSolicitud(idSolicitud));
}

/**
 * Callback de los botones [✅ Aprobar] [❌ Rechazar] de una solicitud.
 * Es independiente de la conversación en curso del chat_id que toca el botón
 * (el propietario puede estar a mitad de otra cosa): se rutea ANTES de leer
 * el estado conversacional, en tgManejarCallbackQuery.
 */
function tgResponderSolicitudCallback(chatId, messageId, aprobar, idSolicitud) {
  const propietario = tgBuscarUsuarioPorChatId(chatId);
  if (!propietario || propietario.rol_global !== 'propietario') {
    tgEditarMensaje(chatId, messageId, 'Solo el propietario puede responder solicitudes.', TG_TECLADO_VACIO);
    return;
  }

  let resultado;
  try {
    resultado = responderSolicitud({ id_solicitud: idSolicitud, aprobar: aprobar }, propietario);
  } catch (err) {
    reportarSentry(err, { origen: 'tgResponderSolicitudCallback', chat_id: chatId, id_solicitud: idSolicitud });
    tgEditarMensaje(chatId, messageId, 'No se pudo procesar la respuesta. Probá de nuevo desde /solicitudes.', TG_TECLADO_VACIO);
    return;
  }

  if (!resultado || resultado.success === false) {
    const error = resultado && resultado.error;
    const detalle = resultado && (resultado.detalle || resultado.error) ? (resultado.detalle || resultado.error) : 'error desconocido';
    // SOLICITUD_YA_RESPONDIDA: el segundo toque de un botón que ya se procesó.
    // Igual se saca el teclado (ya debería haber salido en la primera respuesta,
    // pero por si el mensaje quedó desactualizado) para no invitar a un tercero.
    const texto = error === 'SOLICITUD_YA_RESPONDIDA'
      ? 'Esta solicitud ya había sido respondida antes. No se hizo nada más.'
      : 'No se pudo responder la solicitud: ' + detalle;
    tgEditarMensaje(chatId, messageId, texto, TG_TECLADO_VACIO);
    return;
  }

  const textoFinal = aprobar ? '✅ Solicitud aprobada. Se registró el gasto.' : '❌ Solicitud rechazada.';
  tgEditarMensaje(chatId, messageId, textoFinal, TG_TECLADO_VACIO);

  tgAvisarSolicitanteRespuesta(resultado, aprobar);
}

function tgAvisarSolicitanteRespuesta(resultado, aprobar) {
  const solicitud = tgDesempaquetar(resultado, 'solicitud') || {};
  const idSolicitante = solicitud.id_solicitante;
  if (!idSolicitante) return;

  const solicitante = tgUsuariosActivos().filter((u) => u.id_usuario === idSolicitante)[0];
  if (!solicitante || !solicitante.telegram_chat_id) return;

  const detalle = tgFormatoMonto(solicitud.monto) + (solicitud.motivo ? ' (' + solicitud.motivo + ')' : '');
  const texto = aprobar ? '✅ Te aprobaron la solicitud de ' + detalle + '.' : '❌ Te rechazaron la solicitud de ' + detalle + '.';
  tgEnviarMensaje(solicitante.telegram_chat_id, texto);
}

function tgComandoSolicitudes(chatId) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;

  if (tgEsPropietario(chatId)) {
    tgListarSolicitudesPendientes(chatId);
  } else {
    tgListarSolicitudesPropias(chatId, usuario);
  }
}

function tgListarSolicitudesPendientes(chatId) {
  const espacios = tgObtenerEspacios();
  let pendientes = [];
  try {
    espacios.forEach((esp) => {
      const resultado = getSolicitudes({ id_espacio: esp.id_espacio, estado: 'solicitada' });
      tgDesempaquetarLista(resultado, 'solicitudes')
        .filter((s) => s.id_espacio === esp.id_espacio && s.estado === 'solicitada')
        .forEach((s) => pendientes.push(tgConEspacio(s, esp)));
    });
  } catch (err) {
    reportarSentry(err, { origen: 'tgListarSolicitudesPendientes', chat_id: chatId });
    tgEnviarMensaje(chatId, 'No pude consultar las solicitudes ahora. Probá de nuevo en un momento.');
    return;
  }

  if (!pendientes.length) {
    tgEnviarMensaje(chatId, 'No hay solicitudes pendientes de responder. 🎉');
    return;
  }

  const usuarios = tgUsuariosActivos();
  pendientes.forEach((s) => {
    const solicitante = usuarios.filter((u) => u.id_usuario === s.id_solicitante)[0];
    const texto = '💸 Solicitud pendiente\n' +
      'De: ' + (solicitante ? solicitante.nombre : s.id_solicitante) + '\n' +
      'Espacio: ' + s._espacio.icono + ' ' + s._espacio.nombre + '\n' +
      'Monto: ' + tgFormatoMonto(s.monto) + '\n' +
      'Motivo: ' + (s.motivo || '');
    tgEnviarMensaje(chatId, texto, tgTecladoSolicitud(s.id_solicitud));
  });
}

function tgListarSolicitudesPropias(chatId, usuario) {
  const espacios = tgObtenerEspacios();
  let propias = [];
  try {
    espacios.forEach((esp) => {
      const resultado = getSolicitudes({ id_espacio: esp.id_espacio });
      tgDesempaquetarLista(resultado, 'solicitudes')
        .filter((s) => s.id_espacio === esp.id_espacio && s.id_solicitante === usuario.id_usuario)
        .forEach((s) => propias.push(tgConEspacio(s, esp)));
    });
  } catch (err) {
    reportarSentry(err, { origen: 'tgListarSolicitudesPropias', chat_id: chatId });
    tgEnviarMensaje(chatId, 'No pude consultar tus solicitudes ahora. Probá de nuevo en un momento.');
    return;
  }

  if (!propias.length) {
    tgEnviarMensaje(chatId, 'No tenés solicitudes registradas. Usá /solicitar <monto> <motivo> para crear una.');
    return;
  }

  propias.sort((a, b) => (a.fecha_solicitud < b.fecha_solicitud ? 1 : -1));

  const lineas = propias.map((s) => {
    const estadoIcono = s.estado === 'aprobada' ? '✅' : (s.estado === 'rechazada' ? '❌' : '⏳');
    return estadoIcono + ' ' + s._espacio.icono + ' ' + tgFormatoMonto(s.monto) + ' — ' + (s.motivo || '') + ' (' + s.estado + ')';
  });

  tgEnviarMensaje(chatId, '📋 Tus solicitudes:\n' + lineas.join('\n'));
}

function tgConEspacio(solicitud, espacio) {
  solicitud._espacio = espacio;
  return solicitud;
}

// ==================== /obligaciones (§4-ter) ====================

function tgComandoObligaciones(chatId) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;

  const periodoActual = tgPeriodoActual();
  const espacios = tgObtenerEspacios();
  const bloques = [];

  try {
    espacios.forEach((esp) => {
      const resultado = getObligaciones({ id_espacio: esp.id_espacio });
      const obligaciones = tgDesempaquetarLista(resultado, 'obligaciones')
        .filter((o) => o.id_espacio === esp.id_espacio && o.activo !== false);
      if (!obligaciones.length) return;

      const lineas = obligaciones.map((o) => {
        const generada = o.ultimo_periodo_generado === periodoActual;
        return '• ' + o.concepto + ': ' + tgFormatoMonto(o.monto_estimado) + ' (día ' + o.dia_vencimiento + ') ' +
          (generada ? '✅ generada este mes' : '⏳ pendiente de generar');
      });
      bloques.push(esp.icono + ' ' + esp.nombre + '\n' + lineas.join('\n'));
    });
  } catch (err) {
    reportarSentry(err, { origen: 'tgComandoObligaciones', chat_id: chatId });
    tgEnviarMensaje(chatId, 'No pude consultar las obligaciones ahora. Probá de nuevo en un momento.');
    return;
  }

  if (!bloques.length) {
    tgEnviarMensaje(chatId, 'No hay obligaciones configuradas todavía.');
    return;
  }

  tgEnviarMensaje(chatId, '📅 Obligaciones del mes:\n\n' + bloques.join('\n\n'));
}

function tgPeriodoActual() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

// ==================== /agregar Y /quitar (SOLO PROPIETARIO) ====================

function tgComandoAgregar(chatId, args) {
  if (!tgEsPropietario(chatId)) {
    tgEnviarMensaje(chatId, 'No tenés permiso para este comando.');
    return;
  }

  const partes = args.trim().split(/\s+/).filter((p) => p.length);
  if (partes.length < 2) {
    tgEnviarMensaje(chatId, 'Uso: /agregar <nombre> <email>');
    return;
  }

  const email = partes[partes.length - 1].toLowerCase();
  const nombre = sanearTexto(partes.slice(0, -1).join(' '), 100);

  if (email.indexOf('@') === -1) {
    tgEnviarMensaje(chatId, 'El último dato debe ser un email válido. Uso: /agregar <nombre> <email>');
    return;
  }

  const existente = tgBuscarUsuarioPorEmail(email);
  if (existente) {
    if (existente.activo) {
      tgEnviarMensaje(chatId, 'Ese email ya está de alta.');
      return;
    }
    withLock(() => tgActualizarCampoUsuario(existente.id_usuario, 'activo', true));
    tgEnviarMensaje(chatId, 'Reactivé a ' + existente.nombre + ' (' + email + ').');
    return;
  }

  withLock(() => {
    const sheet = getSheet(SHEETS.USUARIOS);
    anexarFila(sheet, {
      id_usuario: generateId('USR'),
      email: email,
      nombre: nombre,
      foto_perfil: '',
      google_id: '', // se completa cuando haga login con Google
      telegram_chat_id: '', // se completa cuando el usuario haga /start
      rol_global: 'miembro',
      moneda_principal: 'PEN', // default del legacy
      fecha_registro: fechaHoraActual(),
      ultima_sesion: '',
      activo: true
    });
  });

  const verificado = tgBuscarUsuarioPorEmail(email);
  if (!verificado) {
    tgEnviarMensaje(chatId, 'No pude crear el usuario. Probá de nuevo.');
    return;
  }
  tgEnviarMensaje(chatId, 'Usuario agregado: ' + nombre + ' (' + email + '). Ya puede vincularse con /start.');
}

function tgComandoQuitar(chatId, args) {
  if (!tgEsPropietario(chatId)) {
    tgEnviarMensaje(chatId, 'No tenés permiso para este comando.');
    return;
  }

  const email = sanearTexto(args.trim(), 200);
  if (!email || email.indexOf('@') === -1) {
    tgEnviarMensaje(chatId, 'Uso: /quitar <email>');
    return;
  }

  const usuario = tgBuscarUsuarioPorEmail(email);
  if (!usuario || !usuario.activo) {
    tgEnviarMensaje(chatId, 'No encontré un usuario activo con ese email.');
    return;
  }

  withLock(() => tgActualizarCampoUsuario(usuario.id_usuario, 'activo', false));
  tgEnviarMensaje(chatId, 'Usuario dado de baja: ' + usuario.nombre + ' (' + email + ').');
}

// ==================== /cancelar ====================

function tgComandoCancelar(chatId) {
  tgBorrarEstado(chatId);
  tgEnviarMensaje(chatId, 'Listo, cancelé la operación en curso.');
}

// ==================== FLUJO POR FOTO (EL PRINCIPAL) ====================

function tgManejarFoto(chatId, photos) {
  const usuario = tgRequiereUsuario(chatId);
  if (!usuario) return;

  // Gemini tarda unos segundos: avisamos de inmediato para que el usuario no se quede
  // mirando el chat sin respuesta.
  tgEnviarAccionChat(chatId, 'typing');
  tgEnviarMensaje(chatId, 'Leyendo el voucher...');

  const mejor = tgFotoMayorResolucion(photos);

  let blob;
  try {
    blob = tgDescargarArchivoTelegram(mejor.file_id);
  } catch (err) {
    reportarSentry(err, { origen: 'tgManejarFoto:descarga', chat_id: chatId });
    tgGuardarEstado(chatId, {
      estado: 'esperando_monto_corregido',
      borrador: { tipo: 'gasto', origen: 'bot_foto', file_id: mejor.file_id, fecha: fechaActual(), descripcion: 'Compra' }
    });
    tgEnviarMensaje(chatId, 'No pude descargar la foto. ¿Cuánto fue el gasto? Mandame solo el número, por ejemplo: 45.90');
    return;
  }

  // Gemini lee el voucher ANTES de saber el espacio (todavía no se preguntó).
  // Se le ofrece la UNIÓN de nombres de categoría de Familia y Telcom: la que
  // sugiera va a ser válida en al menos uno de los dos libros. Recién cuando
  // la persona confirme el espacio (tgProcesarSeleccionEspacio) se resuelve
  // contra la lista real de ESE espacio.
  const nombresCategorias = tgObtenerCategoriasCombinadas('gasto');

  // geminiLeerVoucher nunca lanza: si Gemini falla del todo, devuelve un
  // objeto con monto null y categoría 'Otros gastos'/confianza 0.
  const lectura = geminiLeerVoucher(blob, nombresCategorias);

  const borrador = {
    tipo: 'gasto',
    monto: lectura.monto,
    descripcion: lectura.comercio ? sanearTexto(lectura.comercio, 200) : 'Compra',
    comercio: lectura.comercio || '',
    fecha: lectura.fecha || fechaActual(),
    categoria_sugerida: null, // se resuelve recién cuando se sepa el espacio
    categoria_sugerida_nombre: lectura.categoria_sugerida || null,
    confianza: lectura.confianza,
    origen: 'bot_foto',
    file_id: mejor.file_id
  };

  if (!lectura.monto || lectura.monto <= 0) {
    // Gemini no pudo leer el monto (o falló del todo): se pide a mano en vez de morir.
    tgGuardarEstado(chatId, { estado: 'esperando_monto_corregido', borrador: borrador });
    tgEnviarMensaje(chatId, 'No pude leer el monto del comprobante. ¿Cuánto fue? Mandame solo el número, por ejemplo: 45.90');
    return;
  }

  tgIniciarSeleccionEspacio(chatId, borrador, null);
}

function tgFotoMayorResolucion(photos) {
  let mejor = photos[0];
  for (let i = 1; i < photos.length; i++) {
    const actual = photos[i];
    const areaMejor = (mejor.width || 0) * (mejor.height || 0);
    const areaActual = (actual.width || 0) * (actual.height || 0);
    if (areaActual > areaMejor) mejor = actual;
  }
  return mejor;
}

function tgDescargarArchivoTelegram(fileId) {
  const token = getProp('TELEGRAM_BOT_TOKEN');

  const respGetFile = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/getFile?file_id=' + encodeURIComponent(fileId),
    { muteHttpExceptions: true }
  );
  const dataGetFile = JSON.parse(respGetFile.getContentText());
  if (!dataGetFile.ok) {
    throw new Error('getFile falló: ' + respGetFile.getContentText());
  }

  const urlArchivo = 'https://api.telegram.org/file/bot' + token + '/' + dataGetFile.result.file_path;
  const respArchivo = UrlFetchApp.fetch(urlArchivo, { muteHttpExceptions: true });
  if (respArchivo.getResponseCode() !== 200) {
    throw new Error('Descarga de archivo falló: HTTP ' + respArchivo.getResponseCode());
  }
  return respArchivo.getBlob();
}

function tgObtenerCategorias(idEspacio, tipo) {
  const resultado = getCategorias(idEspacio, tipo);
  if (Array.isArray(resultado)) return resultado;
  if (resultado && Array.isArray(resultado.categorias)) return resultado.categorias;
  if (resultado && resultado.data && Array.isArray(resultado.data.categorias)) return resultado.data.categorias;
  return [];
}

/** Unión (sin duplicados por nombre) de las categorías de un tipo en TODOS los espacios. Solo para el prompt de Gemini. */
function tgObtenerCategoriasCombinadas(tipo) {
  const espacios = tgObtenerEspacios();
  const vistos = {};
  const nombres = [];
  espacios.forEach((esp) => {
    tgObtenerCategorias(esp.id_espacio, tipo).forEach((c) => {
      if (!vistos[c.nombre]) {
        vistos[c.nombre] = true;
        nombres.push(c.nombre);
      }
    });
  });
  return nombres;
}

function tgBuscarCategoriaPorNombre(categorias, nombre) {
  if (!nombre) return null;
  const normalizado = String(nombre).trim().toLowerCase();
  for (let i = 0; i < categorias.length; i++) {
    if (String(categorias[i].nombre).trim().toLowerCase() === normalizado) return categorias[i];
  }
  return null;
}

// ==================== SELECCIÓN DE ESPACIO → USUARIO → CATEGORÍA → CONFIRMACIÓN ====================
// Paso común a los flujos de foto (desde 41_gemini.js) y de texto (/gasto, /ingreso).
// Nada se escribe en Sheets hasta tgConfirmarGuardado(). El espacio se pregunta
// ANTES que el usuario (contrato §5): categoría y cuenta dependen de él.

function tgIniciarSeleccionEspacio(chatId, borrador, mensajeIdAEditar) {
  const espacios = tgObtenerEspacios();
  const ultimo = tgLeerUltimoEspacio(chatId);
  const ordenados = tgOrdenarEspacios(espacios, ultimo);

  const estado = {
    estado: 'esperando_espacio',
    borrador: borrador,
    espacios_idx: ordenados.map((e) => e.id_espacio)
  };

  const teclado = tgTecladoEspacios(ordenados);
  const texto = tgResumenBorrador(borrador) + '\n\n¿A qué espacio pertenece este ' + (borrador.tipo === 'ingreso' ? 'ingreso' : 'gasto') + '?';

  if (mensajeIdAEditar) {
    estado.mensaje_id = mensajeIdAEditar;
    tgGuardarEstado(chatId, estado);
    tgEditarMensaje(chatId, mensajeIdAEditar, texto, teclado);
    return;
  }

  const enviado = tgEnviarMensaje(chatId, texto, teclado);
  const messageId = tgIdDeMensajeEnviado(enviado);
  if (messageId) estado.mensaje_id = messageId;
  tgGuardarEstado(chatId, estado);
}

function tgProcesarSeleccionEspacio(chatId, estado, idxStr) {
  const idx = parseInt(idxStr, 10);
  const idEspacio = estado.espacios_idx && estado.espacios_idx[idx];
  const espacios = tgObtenerEspacios();
  const espacioMeta = tgEspacioPorId(espacios, idEspacio);

  if (!idEspacio || !espacioMeta) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No reconozco esa selección. Empezá de nuevo.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  estado.borrador.id_espacio = idEspacio;
  estado.borrador.espacio_nombre = espacioMeta.nombre;
  estado.borrador.espacio_icono = espacioMeta.icono || '';
  tgGuardarUltimoEspacio(chatId, idEspacio);

  // La categoría que sugirió Gemini (flujo foto) se probó contra la UNIÓN de
  // ambos libros; recién acá, con el espacio ya confirmado por la persona, se
  // busca de nuevo en la lista real de ESE espacio. Si Gemini sugirió algo del
  // otro libro no hay match: no se preselecciona nada y se elige a mano.
  if (estado.borrador.categoria_sugerida_nombre && estado.borrador.tipo === 'gasto') {
    const categoriasEspacio = tgObtenerCategorias(idEspacio, 'gasto');
    const match = tgBuscarCategoriaPorNombre(categoriasEspacio, estado.borrador.categoria_sugerida_nombre);
    estado.borrador.categoria_sugerida = match ? match.id_categoria : null;
    if (!match) estado.borrador.categoria_sugerida_nombre = null;
  }

  tgIniciarSeleccionUsuario(chatId, estado.borrador, estado.mensaje_id);
}

function tgIniciarSeleccionUsuario(chatId, borrador, mensajeIdAEditar) {
  const usuarios = tgUsuariosActivos();
  if (!usuarios.length) {
    tgEnviarMensaje(chatId, 'No hay usuarios activos para asignar el gasto. Avisale al administrador.');
    return;
  }

  const estado = {
    estado: 'esperando_usuario',
    borrador: borrador,
    usuarios_idx: usuarios.map((u) => u.id_usuario)
  };

  const teclado = tgTecladoUsuarios(usuarios);
  const texto = tgResumenBorrador(borrador) + '\n\n¿De quién es este ' + (borrador.tipo === 'ingreso' ? 'ingreso' : 'gasto') + '?';

  if (mensajeIdAEditar) {
    estado.mensaje_id = mensajeIdAEditar;
    tgGuardarEstado(chatId, estado);
    tgEditarMensaje(chatId, mensajeIdAEditar, texto, teclado);
    return;
  }

  const enviado = tgEnviarMensaje(chatId, texto, teclado);
  const messageId = tgIdDeMensajeEnviado(enviado);
  if (messageId) estado.mensaje_id = messageId;
  tgGuardarEstado(chatId, estado);
}

function tgManejarCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data || '';

  // Siempre responder para que el botón deje de girar, pase lo que pase después.
  tgResponderCallback(callbackQuery.id);

  const partes = data.split(':');
  const accion = partes[0];
  const valor = partes[1];

  // Aprobar/rechazar una solicitud es independiente de la conversación en
  // curso del chat_id que toca el botón (puede ser el propietario a mitad de
  // otra cosa): se rutea ANTES de leer el estado conversacional.
  if (accion === 'sap' || accion === 'srj') {
    tgResponderSolicitudCallback(chatId, messageId, accion === 'sap', valor);
    return;
  }

  const estado = tgLeerEstado(chatId);
  if (!estado) {
    tgEditarMensaje(chatId, messageId, 'Esta operación expiró. Empezá de nuevo con /gasto, /ingreso o mandando una foto.', TG_TECLADO_VACIO);
    return;
  }
  estado.mensaje_id = messageId;

  if (accion === 'cancel') {
    tgBorrarEstado(chatId);
    tgEditarMensaje(chatId, messageId, '❌ Cancelado.', TG_TECLADO_VACIO);
    return;
  }

  if (accion === 'e' && estado.estado === 'esperando_espacio') {
    tgProcesarSeleccionEspacio(chatId, estado, valor);
    return;
  }

  if (accion === 'e' && estado.estado === 'esperando_espacio_accion') {
    tgProcesarSeleccionEspacioAccion(chatId, estado, valor);
    return;
  }

  if (accion === 'e' && estado.estado === 'esperando_espacio_solicitud') {
    tgProcesarSeleccionEspacioSolicitud(chatId, estado, valor);
    return;
  }

  if (accion === 'u' && estado.estado === 'esperando_usuario') {
    tgProcesarSeleccionUsuario(chatId, estado, valor);
    return;
  }

  if (accion === 'c' && estado.estado === 'esperando_categoria') {
    tgProcesarSeleccionCategoria(chatId, estado, valor);
    return;
  }

  if (accion === 'c' && estado.estado === 'esperando_categoria_solicitud') {
    tgProcesarSeleccionCategoriaSolicitud(chatId, estado, valor);
    return;
  }

  if (estado.estado === 'esperando_confirmacion' && accion === 'ok') {
    tgConfirmarGuardado(chatId, estado);
    return;
  }

  if (estado.estado === 'esperando_confirmacion' && accion === 'edit') {
    tgPedirMontoCorregido(chatId, estado);
    return;
  }

  tgEditarMensaje(chatId, messageId, 'No pude procesar esa acción. Empezá de nuevo con /gasto, /ingreso o una foto.', TG_TECLADO_VACIO);
}

function tgProcesarSeleccionUsuario(chatId, estado, idxStr) {
  const idx = parseInt(idxStr, 10);
  const idUsuario = estado.usuarios_idx && estado.usuarios_idx[idx];
  if (!idUsuario) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No reconozco esa selección. Empezá de nuevo.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  const usuarios = tgUsuariosActivos();
  const usuario = usuarios.filter((u) => u.id_usuario === idUsuario)[0];

  estado.borrador.id_usuario = idUsuario;
  estado.borrador.usuario_nombre = usuario ? usuario.nombre : idUsuario;

  const tipoCategoria = estado.borrador.tipo === 'ingreso' ? 'ingreso' : 'gasto';
  let categorias = tgObtenerCategorias(estado.borrador.id_espacio, tipoCategoria);
  if (!categorias.length) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No hay categorías configuradas para ' + tipoCategoria + ' en ' + estado.borrador.espacio_nombre + '. Avisale al administrador.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  // La sugerida de Gemini (si hay, y si aplica a este espacio) va primero; el
  // orden acá DEBE coincidir con el orden usado para construir categorias_idx
  // y el teclado.
  categorias = tgOrdenarCategoriasConSugerida(categorias, estado.borrador.categoria_sugerida);

  estado.categorias_idx = categorias.map((c) => c.id_categoria);
  estado.estado = 'esperando_categoria';
  tgGuardarEstado(chatId, estado);

  const teclado = tgTecladoCategorias(categorias, estado.borrador.categoria_sugerida);
  const texto = tgResumenBorrador(estado.borrador) + '\nAsignado a: ' + estado.borrador.usuario_nombre + '\n\n¿Qué categoría es?';
  tgEditarMensaje(chatId, estado.mensaje_id, texto, teclado);
}

function tgProcesarSeleccionCategoria(chatId, estado, idxStr) {
  const idx = parseInt(idxStr, 10);
  const idCategoria = estado.categorias_idx && estado.categorias_idx[idx];
  if (!idCategoria) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'No reconozco esa categoría. Empezá de nuevo.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  const tipoCategoria = estado.borrador.tipo === 'ingreso' ? 'ingreso' : 'gasto';
  const categorias = tgObtenerCategorias(estado.borrador.id_espacio, tipoCategoria);
  const categoria = categorias.filter((c) => c.id_categoria === idCategoria)[0];

  estado.borrador.id_categoria = idCategoria;
  estado.borrador.categoria_nombre = categoria ? categoria.nombre : idCategoria;
  estado.estado = 'esperando_confirmacion';
  tgGuardarEstado(chatId, estado);

  const teclado = tgTecladoConfirmacion();
  const texto = tgResumenConfirmacion(estado.borrador);
  tgEditarMensaje(chatId, estado.mensaje_id, texto, teclado);
}

function tgPedirMontoCorregido(chatId, estado) {
  estado.estado = 'esperando_monto_corregido';
  tgGuardarEstado(chatId, estado);
  tgEditarMensaje(chatId, estado.mensaje_id, 'Mandame el monto correcto (solo el número, por ejemplo: 45.90).', TG_TECLADO_VACIO);
}

function tgProcesarMontoCorregido(chatId, texto, estado) {
  const validacion = validarMonto(texto);
  if (!validacion.valido) {
    tgEnviarMensaje(chatId, 'Ese monto no es válido. Mandame solo el número, por ejemplo: 45.90');
    return;
  }
  estado.borrador.monto = validacion.valor;

  if (estado.borrador.id_usuario && estado.borrador.id_categoria) {
    // Venía del botón "✏️ Corregir monto" en la pantalla de confirmación:
    // ya había espacio+usuario+categoría elegidos, se vuelve directo a confirmar.
    estado.estado = 'esperando_confirmacion';
    tgGuardarEstado(chatId, estado);
    const teclado = tgTecladoConfirmacion();
    const textoResumen = tgResumenConfirmacion(estado.borrador);
    if (estado.mensaje_id) {
      tgEditarMensaje(chatId, estado.mensaje_id, textoResumen, teclado);
    } else {
      tgEnviarMensaje(chatId, textoResumen, teclado);
    }
    return;
  }

  // Venía de una foto que Gemini no pudo leer (o no pudo descargar): seguir al paso de espacio.
  tgIniciarSeleccionEspacio(chatId, estado.borrador, null);
}

// ==================== GUARDADO FINAL ====================
// Único punto del flujo que escribe en Sheets/Drive. Todo lo anterior vivió
// solo en el borrador del estado del cache.

function tgConfirmarGuardado(chatId, estado) {
  const borrador = estado.borrador;

  if (!borrador.id_espacio || !borrador.id_usuario || !borrador.id_categoria || !borrador.monto) {
    tgEditarMensaje(chatId, estado.mensaje_id, 'Falta información para guardar. Empezá de nuevo con /gasto, /ingreso o una foto.', TG_TECLADO_VACIO);
    tgBorrarEstado(chatId);
    return;
  }

  let resultado;
  try {
    resultado = tgGuardarTransaccionDesdeBorrador(borrador);
  } catch (err) {
    reportarSentry(err, { origen: 'tgConfirmarGuardado', chat_id: chatId, borrador: borrador });
    tgEditarMensaje(chatId, estado.mensaje_id, 'No se pudo guardar. Probá de nuevo tocando "✅ Guardar".', tgTecladoReintento());
    return; // se deja el estado vivo para poder reintentar con el mismo botón
  }

  if (!resultado || resultado.success === false) {
    tgBorrarEstado(chatId);
    const detalle = resultado && (resultado.detalle || resultado.error) ? (resultado.detalle || resultado.error) : 'error desconocido';
    tgEditarMensaje(chatId, estado.mensaje_id, 'No se pudo guardar: ' + detalle + '. Empezá de nuevo.', TG_TECLADO_VACIO);
    return;
  }

  tgBorrarEstado(chatId);
  tgEditarMensaje(chatId, estado.mensaje_id, '✅ Guardado.\n' + tgResumenConfirmacion(borrador), TG_TECLADO_VACIO);
}

// El estado se deja vivo tras un fallo de guardado para poder reintentar con
// el mismo botón "✅ Guardar": el teclado de confirmación se vuelve a mandar
// tal cual (no uno vacío), porque acá la persona SÍ tiene que poder tocar de nuevo.
function tgTecladoReintento() {
  return tgTecladoConfirmacion();
}

// NOTA: no envolvemos esta función en withLock() propio. crearTransaccion()
// y subirEvidencia() ya adquieren y liberan su propio LockService.getScriptLock()
// internamente; anidar otro withLock() acá arriba correría el riesgo de que el
// release() de la llamada interna libere el lock antes de que termine el resto
// de este flujo (LockService.getScriptLock() es el mismo lock por ejecución).
function tgGuardarTransaccionDesdeBorrador(borrador) {
  const cuenta = tgObtenerCuentaPorDefecto(borrador.id_espacio);
  if (!cuenta) {
    return { success: false, error: 'SIN_CUENTA', detalle: 'no hay ninguna cuenta activa configurada en ' + (borrador.espacio_nombre || 'este espacio') };
  }

  const creada = crearTransaccion({
    id_espacio: borrador.id_espacio,
    id_usuario: borrador.id_usuario,
    id_cuenta: cuenta.id_cuenta,
    id_categoria: borrador.id_categoria,
    tipo: borrador.tipo,
    monto: borrador.monto,
    descripcion: borrador.descripcion,
    fecha: borrador.fecha,
    origen: borrador.origen || 'bot_texto'
  });

  if (!creada || creada.success === false) return creada;

  const idTransaccion = creada.data && creada.data.id_transaccion;

  if (borrador.file_id && idTransaccion) {
    try {
      const blob = tgDescargarArchivoTelegram(borrador.file_id);
      subirEvidencia({
        id_transaccion: idTransaccion,
        tipo: 'imagen',
        contenido_base64: Utilities.base64Encode(blob.getBytes()),
        mime_type: blob.getContentType() || 'image/jpeg',
        nombre_archivo: 'voucher_' + idTransaccion + '.jpg',
        tamano: blob.getBytes().length
      });
    } catch (errEvidencia) {
      // La transacción ya quedó guardada: no la revertimos, solo reportamos
      // que la evidencia no se pudo subir.
      reportarSentry(errEvidencia, { origen: 'tgGuardarTransaccionDesdeBorrador:evidencia', id_transaccion: idTransaccion });
    }
  }

  return creada;
}

function tgObtenerCuentaPorDefecto(idEspacio) {
  const cuentas = getAllData(getSheet(SHEETS.CUENTAS)).filter(
    (c) => c.id_espacio === idEspacio && c.activo
  );
  if (!cuentas.length) return null;
  cuentas.sort((a, b) => (parseFloat(a.orden) || 0) - (parseFloat(b.orden) || 0));
  return cuentas[0];
}

// ==================== TEXTOS DE RESUMEN ====================

function tgFormatoMonto(valor) {
  const n = parseFloat(valor);
  return (isNaN(n) ? 0 : n).toFixed(2);
}

function tgResumenBorrador(borrador) {
  const lineas = [];
  lineas.push((borrador.tipo === 'ingreso' ? '💰 Ingreso' : '🧾 Gasto') + ': ' + tgFormatoMonto(borrador.monto));
  if (borrador.espacio_nombre) lineas.push('Espacio: ' + borrador.espacio_icono + ' ' + borrador.espacio_nombre);
  if (borrador.comercio) lineas.push('Comercio: ' + borrador.comercio);
  if (borrador.descripcion) lineas.push('Descripción: ' + borrador.descripcion);
  lineas.push('Fecha: ' + borrador.fecha);
  if (borrador.categoria_sugerida_nombre) {
    const conf = typeof borrador.confianza === 'number' ? ' (confianza ' + Math.round(borrador.confianza * 100) + '%)' : '';
    lineas.push('Categoría sugerida: ' + borrador.categoria_sugerida_nombre + conf);
  }
  return lineas.join('\n');
}

function tgResumenConfirmacion(borrador) {
  const lineas = [];
  lineas.push((borrador.tipo === 'ingreso' ? '💰 Ingreso' : '🧾 Gasto') + ': ' + tgFormatoMonto(borrador.monto));
  lineas.push('Espacio: ' + borrador.espacio_icono + ' ' + borrador.espacio_nombre);
  if (borrador.comercio) lineas.push('Comercio: ' + borrador.comercio);
  lineas.push('Descripción: ' + borrador.descripcion);
  lineas.push('Fecha: ' + borrador.fecha);
  lineas.push('De: ' + borrador.usuario_nombre);
  lineas.push('Categoría: ' + borrador.categoria_nombre);
  return lineas.join('\n');
}

// ==================== ESTADO POR CHAT (CacheService) ====================

function tgClaveEstado(chatId) {
  return 'tg_estado_' + chatId;
}

function tgGuardarEstado(chatId, estado) {
  CacheService.getScriptCache().put(tgClaveEstado(chatId), JSON.stringify(estado), TG_ESTADO_TTL_SEGUNDOS);
}

function tgLeerEstado(chatId) {
  const crudo = CacheService.getScriptCache().get(tgClaveEstado(chatId));
  if (!crudo) return null;
  try {
    return JSON.parse(crudo);
  } catch (err) {
    return null;
  }
}

function tgBorrarEstado(chatId) {
  CacheService.getScriptCache().remove(tgClaveEstado(chatId));
}

// Último espacio usado por este chat_id — solo una comodidad para ordenar los
// botones (el más probable primero); SIEMPRE se sigue pidiendo confirmarlo
// con un toque (contrato §5). TTL al tope real de CacheService (6h): si
// expira, simplemente no hay "último" y se muestran en el orden por defecto.
function tgClaveUltimoEspacio(chatId) {
  return 'tg_ultimo_espacio_' + chatId;
}

function tgGuardarUltimoEspacio(chatId, idEspacio) {
  CacheService.getScriptCache().put(tgClaveUltimoEspacio(chatId), idEspacio, TG_ULTIMO_ESPACIO_TTL_SEGUNDOS);
}

function tgLeerUltimoEspacio(chatId) {
  return CacheService.getScriptCache().get(tgClaveUltimoEspacio(chatId));
}

// ==================== BAJO NIVEL: BOT API DE TELEGRAM ====================

function tgLlamarApi(metodo, payload) {
  const token = getProp('TELEGRAM_BOT_TOKEN');
  const url = 'https://api.telegram.org/bot' + token + '/' + metodo;

  const respuesta = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  let data = null;
  try {
    data = JSON.parse(respuesta.getContentText());
  } catch (err) {
    // respuesta no-JSON: se reporta abajo con el texto crudo
  }

  if (!data || !data.ok) {
    reportarSentry(new Error('Telegram API ' + metodo + ' falló'), {
      origen: 'tgLlamarApi',
      metodo: metodo,
      respuesta: respuesta.getContentText().slice(0, 500)
    });
  }

  return data;
}

function tgEnviarMensaje(chatId, texto, teclado) {
  const payload = { chat_id: chatId, text: texto };
  if (teclado) payload.reply_markup = teclado;
  return tgLlamarApi('sendMessage', payload);
}

function tgEditarMensaje(chatId, messageId, texto, teclado) {
  const payload = { chat_id: chatId, message_id: messageId, text: texto };
  if (teclado) payload.reply_markup = teclado;

  const resultado = tgLlamarApi('editMessageText', payload);
  if (!resultado || !resultado.ok) {
    // El mensaje puede ser muy viejo para editar (o haber sido borrado):
    // mandamos uno nuevo para no dejar al usuario sin respuesta.
    return tgEnviarMensaje(chatId, texto, teclado);
  }
  return resultado;
}

function tgResponderCallback(callbackQueryId, texto) {
  const payload = { callback_query_id: callbackQueryId };
  if (texto) payload.text = texto;
  return tgLlamarApi('answerCallbackQuery', payload);
}

function tgEnviarAccionChat(chatId, accion) {
  return tgLlamarApi('sendChatAction', { chat_id: chatId, action: accion });
}

function tgIdDeMensajeEnviado(respuesta) {
  return respuesta && respuesta.ok && respuesta.result ? respuesta.result.message_id : null;
}
