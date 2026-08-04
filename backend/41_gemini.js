// ==================== LECTURA DE VOUCHERS CON GEMINI ====================
//
// Dueño: agente de BOT DE TELEGRAM + GEMINI.
// Manda la foto del comprobante a Gemini (gemini-2.0-flash) pidiendo JSON
// estricto vía responseSchema. Nunca lanza: si todo falla, devuelve un
// objeto de "fallback" con monto null y categoria 'Otros gastos' para que
// 40_telegram.js pueda pedir el monto a mano en vez de romper el flujo.
//
// Dependencias externas asumidas (no definidas en este archivo):
//   getProp(clave), reportarSentry(error, contexto), validarMonto(valor),
//   sanearTexto(valor, maxLen), fechaActual()

const GEMINI_MODELO = 'gemini-2.0-flash';
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Lee un voucher/comprobante desde un Blob de imagen y devuelve:
 *   { monto: number|null, comercio: string, fecha: 'yyyy-MM-dd',
 *     categoria_sugerida: string, confianza: number }
 *
 * `categoriasDisponibles` es la lista cerrada de nombres de categoría
 * (de gasto) del espacio compartido; categoria_sugerida siempre sale de
 * esa lista o cae a 'Otros gastos' con confianza 0.
 *
 * Hace un intento y, si falla (timeout, HTTP != 200, JSON no parseable),
 * un único reintento. Si el segundo intento también falla, devuelve el
 * fallback sin lanzar excepción.
 */
function geminiLeerVoucher(blob, categoriasDisponibles) {
  const categorias = (categoriasDisponibles && categoriasDisponibles.length)
    ? categoriasDisponibles
    : ['Otros gastos'];

  const fallback = {
    monto: null,
    comercio: '',
    fecha: fechaActual(),
    categoria_sugerida: 'Otros gastos',
    confianza: 0
  };

  let bruto = geminiIntentarLeerVoucher(blob, categorias);
  if (!bruto) {
    bruto = geminiIntentarLeerVoucher(blob, categorias); // reintento único
  }
  if (!bruto) return fallback;

  return geminiNormalizarLectura(bruto, categorias, fallback);
}

/**
 * Un solo intento de llamada a Gemini. Devuelve el objeto crudo parseado
 * (sin validar contra la lista de categorías) o null si algo falló.
 * Apps Script no permite configurar un timeout corto en UrlFetchApp (el
 * runtime impone su propio límite); acá solo controlamos reintento y
 * capturamos cualquier excepción para no tumbar el flujo del bot.
 */
function geminiIntentarLeerVoucher(blob, categorias) {
  try {
    const apiKey = getProp('GEMINI_API_KEY');
    const url = GEMINI_URL_BASE + GEMINI_MODELO + ':generateContent?key=' + encodeURIComponent(apiKey);

    const payload = {
      contents: [{
        parts: [
          { text: geminiConstruirPrompt(categorias) },
          {
            inline_data: {
              mime_type: blob.getContentType() || 'image/jpeg',
              data: Utilities.base64Encode(blob.getBytes())
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: geminiConstruirSchema(categorias)
      }
    };

    const respuesta = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (respuesta.getResponseCode() !== 200) {
      reportarSentry(new Error('Gemini respondió HTTP ' + respuesta.getResponseCode()), {
        origen: 'geminiIntentarLeerVoucher',
        cuerpo: respuesta.getContentText().slice(0, 500)
      });
      return null;
    }

    const data = JSON.parse(respuesta.getContentText());
    const texto = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    if (!texto) return null;

    return JSON.parse(texto);
  } catch (err) {
    reportarSentry(err, { origen: 'geminiIntentarLeerVoucher' });
    return null;
  }
}

function geminiConstruirPrompt(categorias) {
  return 'Sos un asistente que lee comprobantes de pago (boletas, facturas, recibos, vouchers) ' +
    'en fotos, en español o inglés.\n' +
    'Mirá la imagen y devolvé EXCLUSIVAMENTE el JSON pedido, con estos campos:\n' +
    '- monto: el monto TOTAL pagado, como número (sin símbolo de moneda ni separador de miles). ' +
    'Si no lográs leerlo con claridad, poné 0.\n' +
    '- comercio: nombre del negocio o establecimiento. Si no se ve, dejalo vacío.\n' +
    '- fecha: la fecha del comprobante en formato yyyy-MM-dd. Si no se distingue, usá la fecha de hoy.\n' +
    '- categoria_sugerida: elegí EXACTAMENTE una de esta lista, tal cual está escrita, la que mejor ' +
    'describa el gasto: ' + categorias.join(', ') + '.\n' +
    '- confianza: número entre 0 y 1 según qué tan seguro estás de la lectura completa.\n' +
    'No inventes datos que no estén en la imagen.';
}

function geminiConstruirSchema(categorias) {
  return {
    type: 'OBJECT',
    properties: {
      monto: { type: 'NUMBER' },
      comercio: { type: 'STRING' },
      fecha: { type: 'STRING' },
      categoria_sugerida: { type: 'STRING', enum: categorias },
      confianza: { type: 'NUMBER' }
    },
    required: ['monto', 'comercio', 'fecha', 'categoria_sugerida', 'confianza']
  };
}

/**
 * Valida y sanea lo que devolvió Gemini. categoria_sugerida SIEMPRE termina
 * dentro de `categorias`, o cae a 'Otros gastos' con confianza 0.
 */
function geminiNormalizarLectura(bruto, categorias, fallback) {
  const validacionMonto = validarMonto(bruto.monto);
  const monto = validacionMonto.valido ? validacionMonto.valor : null;

  let categoriaSugerida = bruto.categoria_sugerida;
  let confianza = typeof bruto.confianza === 'number' ? bruto.confianza : 0;

  if (categorias.indexOf(categoriaSugerida) === -1) {
    categoriaSugerida = 'Otros gastos';
    confianza = 0;
  }

  return {
    monto: monto,
    comercio: bruto.comercio ? sanearTexto(String(bruto.comercio), 200) : '',
    fecha: geminiValidarFecha(bruto.fecha) || fallback.fecha,
    categoria_sugerida: categoriaSugerida,
    confianza: confianza
  };
}

function geminiValidarFecha(fecha) {
  if (!fecha || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return fecha;
}
