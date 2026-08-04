/**
 * lib_validacion.js — PURO. Nada de SpreadsheetApp ni servicios de Google aquí.
 * Firmas exactas — docs/CONTRACT.md § "Firmas obligatorias de la lógica pura".
 */

var _ERRORES_HOJA_CALCULO = /^#(NUM|REF|VALUE|N\/A|DIV\/0|NULL|NAME)!?$/i;

/**
 * validarMonto(valor) → { valido, valor: number, error?, detalle? }
 * Rechaza NaN, null, '', '#NUM!', Infinity, negativos, > 1e9.
 * Acepta number y string con coma o punto decimal ('45,90' → 45.9).
 */
function validarMonto(valor) {
  if (valor === null || valor === undefined || valor === '') {
    return { valido: false, valor: NaN, error: 'MONTO_INVALIDO', detalle: 'El monto es requerido.' };
  }

  if (typeof valor !== 'number' && typeof valor !== 'string') {
    return { valido: false, valor: NaN, error: 'MONTO_INVALIDO', detalle: 'El monto debe ser un número o un texto numérico.' };
  }

  var texto = String(valor).trim();

  if (_ERRORES_HOJA_CALCULO.test(texto)) {
    return { valido: false, valor: NaN, error: 'MONTO_INVALIDO', detalle: 'El monto contiene un error de hoja de cálculo (' + texto + ').' };
  }

  if (typeof valor === 'string') {
    texto = texto.replace(/\s/g, '');
    if (texto.indexOf(',') !== -1 && texto.indexOf('.') === -1) {
      // Coma como separador decimal: '45,90' → '45.90'
      texto = texto.replace(',', '.');
    } else if (texto.indexOf(',') !== -1 && texto.indexOf('.') !== -1) {
      // Miles con punto y decimal con coma: '1.234,56' → '1234.56'
      texto = texto.replace(/\./g, '').replace(',', '.');
    }
  }

  var numero = parseFloat(texto);

  if (isNaN(numero) || !isFinite(numero)) {
    return { valido: false, valor: NaN, error: 'MONTO_INVALIDO', detalle: 'El monto "' + valor + '" no es un número válido.' };
  }
  if (numero < 0) {
    return { valido: false, valor: NaN, error: 'MONTO_INVALIDO', detalle: 'El monto no puede ser negativo.' };
  }
  if (numero > 1e9) {
    return { valido: false, valor: NaN, error: 'MONTO_INVALIDO', detalle: 'El monto excede el máximo permitido.' };
  }

  return { valido: true, valor: numero };
}

/**
 * validarRequeridos(obj, campos) → { valido, error?, detalle? }
 */
function validarRequeridos(obj, campos) {
  var faltantes = [];
  (campos || []).forEach(function (campo) {
    var v = obj ? obj[campo] : undefined;
    if (v === undefined || v === null || v === '') faltantes.push(campo);
  });
  if (faltantes.length > 0) {
    return { valido: false, error: 'CAMPO_REQUERIDO', detalle: 'falta: ' + faltantes.join(', ') };
  }
  return { valido: true };
}

/**
 * validarFecha(valor) → { valido, valor: 'yyyy-MM-dd', error? }
 */
function validarFecha(valor) {
  if (!valor) {
    return { valido: false, error: 'FECHA_INVALIDA', detalle: 'La fecha es requerida.' };
  }

  var esInstanciaDate = Object.prototype.toString.call(valor) === '[object Date]';

  if (!esInstanciaDate && typeof valor !== 'string') {
    return { valido: false, error: 'FECHA_INVALIDA', detalle: 'La fecha "' + valor + '" no es válida.' };
  }

  var anio, mes, dia;

  if (esInstanciaDate) {
    if (isNaN(valor.getTime())) {
      return { valido: false, error: 'FECHA_INVALIDA', detalle: 'La fecha no es válida.' };
    }
    anio = valor.getFullYear();
    mes = valor.getMonth() + 1;
    dia = valor.getDate();
  } else {
    // Solo se acepta yyyy-MM-dd (con o sin hora pegada): nada de dd/mm/yyyy,
    // fechas incompletas ni texto libre. Sin esto, `new Date(texto)` de V8
    // acepta formatos ambiguos que el contrato no permite.
    var m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
    if (!m) {
      return { valido: false, error: 'FECHA_INVALIDA', detalle: 'La fecha "' + valor + '" no tiene el formato yyyy-MM-dd.' };
    }

    anio = Number(m[1]);
    mes = Number(m[2]);
    dia = Number(m[3]);

    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { valido: false, error: 'FECHA_INVALIDA', detalle: 'La fecha "' + valor + '" no es válida.' };
    }

    // Descarta fechas que no existen en el calendario (30 de febrero, 29 de
    // febrero en año no bisiesto, etc.): Date normalmente las "rueda" al mes
    // siguiente en vez de fallar, así que se verifica que no haya rodado.
    var comprobacion = new Date(anio, mes - 1, dia);
    if (comprobacion.getFullYear() !== anio || comprobacion.getMonth() !== mes - 1 || comprobacion.getDate() !== dia) {
      return { valido: false, error: 'FECHA_INVALIDA', detalle: 'La fecha "' + valor + '" no existe en el calendario.' };
    }
  }

  var mm = String(mes);
  if (mm.length < 2) mm = '0' + mm;
  var dd = String(dia);
  if (dd.length < 2) dd = '0' + dd;

  return { valido: true, valor: anio + '-' + mm + '-' + dd };
}

/**
 * validarTipo(valor, permitidos) → { valido, valor, error? }
 */
function validarTipo(valor, permitidos) {
  var lista = permitidos || [];
  if (valor === undefined || valor === null || valor === '' || lista.indexOf(valor) === -1) {
    return { valido: false, valor: valor, error: 'CAMPO_REQUERIDO', detalle: 'Valor no permitido, se esperaba uno de: ' + lista.join(', ') };
  }
  return { valido: true, valor: valor };
}

/**
 * esFilaCorrupta(fila, camposNum) → bool.
 * true si algún campo numérico es '#NUM!', '#REF!', '#VALUE!' o NaN.
 */
function esFilaCorrupta(fila, camposNum) {
  if (!fila) return false;
  return (camposNum || []).some(function (campo) {
    var v = fila[campo];
    if (v === '' || v === null || v === undefined) return false;
    if (typeof v === 'number') return isNaN(v);
    var texto = String(v).trim();
    if (_ERRORES_HOJA_CALCULO.test(texto)) return true;
    return isNaN(parseFloat(texto.replace(',', '.')));
  });
}

/**
 * sanearTexto(valor, maxLen) → string recortado, sin caracteres de control.
 */
function sanearTexto(valor, maxLen) {
  if (valor === null || valor === undefined) return '';
  var texto = String(valor).replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (maxLen && texto.length > maxLen) {
    texto = texto.substring(0, maxLen);
  }
  return texto;
}

if (typeof module !== 'undefined') {
  module.exports = {
    validarMonto: validarMonto,
    validarRequeridos: validarRequeridos,
    validarFecha: validarFecha,
    validarTipo: validarTipo,
    esFilaCorrupta: esFilaCorrupta,
    sanearTexto: sanearTexto
  };
}
