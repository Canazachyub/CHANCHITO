// ==================== TRIGGERS DIARIOS ====================
//
// Dueño: agente de BOT DE TELEGRAM + GEMINI (triggers originales) + agente de
// SOLICITUDES/OBLIGACIONES (trigger de generarObligacionesDelMes, agregado
// sin tocar el resto — docs/CONTRACT.md § 4-ter).
// configurarTriggersChanchito() es idempotente: borra los triggers que
// ella misma creó antes de recrearlos, así se puede correr de nuevo sin
// duplicar triggers. Ejecutar manualmente una vez después de desplegar.
//
// Dependencias externas reales (verificadas contra el código ya presente en
// /backend, no contra el encargo original — algunos nombres difieren):
//   getSheet, getAllData, withLock, fechaActual,
//   SHEETS.{USUARIOS,TRANSACCIONES,DEUDAS,CATEGORIAS,CUENTAS,PRESUPUESTOS,GASTOS_RECURRENTES},
//   ESPACIO_COMPARTIDO_ID, crearNotificacionInterna, getDeudas,
//   diasHastaVencimiento, validarMonto, reportarSentry.
// Funciones de dominio ya existentes que este archivo reutiliza tal cual en
// vez de reimplementar (evita divergencias con la lógica canónica):
//   ejecutarGastoRecurrente(idGastoRecurrente) — backend/19_recurrentes.js,
//     ya valida existencia, crea la transacción y actualiza proximo_ejecucion
//     dentro de un único withLock() atómico.
//   getProgresoPresupuesto(idPresupuesto) — backend/18_presupuestos.js, ya
//     calcula el gasto por categoría/mes/año y aplica calcularProgresoPresupuesto
//     de lib_calculos.js.
//   generarObligacionesDelMes() — backend/24_obligaciones.js, ya es idempotente
//     por sí sola (usa ultimo_periodo_generado) y ya tiene su propio
//     withLock() + try/catch con reportarSentry; este archivo solo la registra
//     como trigger diario, no reimplementa nada de su lógica.
// De este mismo agente (40_telegram.js): tgEnviarMensaje, tgFormatoMonto,
//   tgDesempaquetarLista.

const TG_TRIGGERS_HANDLERS = [
  'tgTriggerRecordatorioDeudas', 'tgTriggerGastosRecurrentes', 'tgTriggerPresupuestos',
  'purgarOperacionesAplicadas', 'generarObligacionesDelMes'
];

/**
 * Configura los cinco triggers diarios (los tres del bot + la purga de
 * OperacionesAplicadas + la generación de obligaciones mensuales).
 * Idempotente: primero borra cualquier trigger existente cuyo handler sea
 * uno de los nuestros, para poder ejecutarla de nuevo sin duplicar.
 */
function configurarTriggersChanchito() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => {
    if (TG_TRIGGERS_HANDLERS.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Antes de los recordatorios de deudas (hora 9): así una obligación que se
  // materializa hoy ya puede avisar por Telegram el mismo día si vence pronto.
  ScriptApp.newTrigger('generarObligacionesDelMes').timeBased().everyDays(1).atHour(5).create();
  ScriptApp.newTrigger('tgTriggerGastosRecurrentes').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('tgTriggerPresupuestos').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('tgTriggerRecordatorioDeudas').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('purgarOperacionesAplicadas').timeBased().everyDays(1).atHour(3).create();
}

// ==================== PURGA DE OperacionesAplicadas ====================
//
// CONTRACT.md § 4, "Idempotencia de op_id — persistente, no en cache": la
// hoja OperacionesAplicadas crece con cada operación de sincronizar; un
// trigger diario purga las filas de más de 30 días. A diferencia de las
// entidades sincronizables (Transacciones/Deudas/Presupuestos), esta hoja NO
// es una entidad que el cliente lea o sincronice — es un log interno de
// idempotencia — así que acá SÍ corresponde deleteRow físico en vez de
// borrado lógico: dejarla crecer para siempre reintroduciría el mismo
// problema de fondo que motivó sacar la idempotencia de CacheService.

function purgarOperacionesAplicadas() {
  try {
    withLock(function () {
      const sheet = getSheet(SHEETS.OPERACIONES_APLICADAS);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      const headers = obtenerEncabezados(sheet);
      const colFecha = headers.indexOf('fecha');
      if (colFecha < 0) return;

      const datos = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      const limite = new Date();
      limite.setDate(limite.getDate() - 30);
      const limiteStr = Utilities.formatDate(limite, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

      // De abajo hacia arriba: borrar de arriba hacia abajo correría los
      // índices de fila de las que todavía faltan revisar.
      for (let i = datos.length - 1; i >= 0; i--) {
        const fechaFila = String(normalizarValorCelda('fecha', datos[i][colFecha]) || '');
        if (fechaFila && fechaFila < limiteStr) {
          sheet.deleteRow(2 + i);
        }
      }
    });
  } catch (err) {
    reportarSentry(err, { origen: 'purgarOperacionesAplicadas' });
  }
}

// ==================== RECORDATORIO DE DEUDAS ====================
//
// CONTRACT.md §5: deudas con estado='pendiente' y fecha_vencimiento a ≤3 días
// → crea Notificacion con canal='telegram' Y manda sendMessage al
// telegram_chat_id del usuario dueño de la deuda (si no tiene chat_id, solo
// la notificación interna). El cambio de estado a 'vencida' no está descrito
// en el alcance de este trigger (CONTRACT.md §5 solo habla de notificar);
// se deja fuera para no invadir la lógica de dominio de Deudas.

function tgTriggerRecordatorioDeudas() {
  try {
    // Recorre los DOS espacios (CONTRACT § 0.3). Antes usaba la constante única
    // ESPACIO_COMPARTIDO_ID, que ya no existe: dejarla habría hecho que el trigger
    // reventara con ReferenceError todos los días, en silencio y sin recordatorios.
    const deudas = [];
    ESPACIOS_POR_DEFECTO.forEach(function (espacio) {
      const resultado = getDeudas(espacio.id, null, 'pendiente');
      tgDesempaquetarLista(resultado, 'deudas').forEach(function (d) { deudas.push(d); });
    });
    const hoy = fechaActual();
    const usuarios = getAllData(getSheet(SHEETS.USUARIOS));

    deudas.forEach((deuda) => {
      if (!deuda.fecha_vencimiento) return;
      if (deuda.recordatorio === false) return; // opt-out explícito del recordatorio

      const dias = diasHastaVencimiento(deuda.fecha_vencimiento, hoy);
      if (dias > 3) return;

      try {
        const vencida = dias < 0;
        const mensaje = 'La deuda con ' + deuda.persona + ' ' +
          (vencida ? ('venció hace ' + Math.abs(dias) + ' días') : ('vence en ' + dias + ' días')) +
          ' (' + tgFormatoMonto(deuda.monto_pendiente) + ').';

        crearNotificacionInterna({
          id_usuario: deuda.id_usuario,
          tipo: 'deuda',
          titulo: vencida ? 'Deuda vencida' : 'Recordatorio de deuda',
          mensaje: mensaje,
          datos: { id_deuda: deuda.id_deuda },
          canal: 'telegram'
        });

        const usuario = usuarios.filter((u) => u.id_usuario === deuda.id_usuario)[0];
        if (usuario && usuario.telegram_chat_id) {
          const icono = vencida ? '⚠️' : '⏰';
          tgEnviarMensaje(usuario.telegram_chat_id, icono + ' ' + mensaje);
        }
      } catch (errUno) {
        reportarSentry(errUno, { origen: 'tgTriggerRecordatorioDeudas:deuda', id_deuda: deuda.id_deuda });
      }
    });
  } catch (err) {
    reportarSentry(err, { origen: 'tgTriggerRecordatorioDeudas' });
  }
}

// ==================== GASTOS RECURRENTES ====================
//
// backend/19_recurrentes.js ya expone ejecutarGastoRecurrente(idGastoRecurrente):
// valida que exista, crea la transacción y actualiza proximo_ejecucion dentro
// de un único withLock() atómico (con una nota explícita de que la orquestación
// diaria — recorrer los `activo` con proximo_ejecucion <= hoy — es responsabilidad
// de este archivo). Se reutiliza esa función tal cual en vez de reimplementar la
// escritura acá, para no divergir de la lógica canónica; este trigger solo agrega
// la validación de monto previa (fix directo al bug de #NUM! del legacy: si el
// monto no es válido, no se ejecuta y se reporta en vez de generar una
// transacción corrupta).

function tgTriggerGastosRecurrentes() {
  try {
    const gastos = getAllData(getSheet(SHEETS.GASTOS_RECURRENTES)).filter((g) => g.activo);
    const hoy = fechaActual();

    gastos.forEach((gasto) => {
      if (!gasto.proximo_ejecucion || gasto.proximo_ejecucion > hoy) return;

      const validacion = validarMonto(gasto.monto);
      if (!validacion.valido) {
        reportarSentry(new Error('Gasto recurrente con monto inválido: ' + gasto.id_gasto_recurrente), { origen: 'tgTriggerGastosRecurrentes' });
        return;
      }

      try {
        const resultado = ejecutarGastoRecurrente(gasto.id_gasto_recurrente);
        if (!resultado || resultado.success === false) {
          reportarSentry(new Error('ejecutarGastoRecurrente no tuvo éxito: ' + gasto.id_gasto_recurrente), {
            origen: 'tgTriggerGastosRecurrentes',
            detalle: resultado && resultado.detalle
          });
        }
      } catch (errUno) {
        reportarSentry(errUno, { origen: 'tgTriggerGastosRecurrentes:gasto', id_gasto_recurrente: gasto.id_gasto_recurrente });
      }
    });
  } catch (err) {
    reportarSentry(err, { origen: 'tgTriggerGastosRecurrentes' });
  }
}

// ==================== PRESUPUESTOS ====================
//
// Reutiliza la lógica de docs/Code.legacy.gs (verificarPresupuestos), pero
// delegando el cálculo de progreso a getProgresoPresupuesto(idPresupuesto)
// (backend/18_presupuestos.js), que ya calcula el gasto por categoría/mes/año
// y aplica calcularProgresoPresupuesto de lib_calculos.js. No se recalcula acá
// para no divergir de esa lógica si cambia.

function tgTriggerPresupuestos() {
  try {
    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const anioActual = hoy.getFullYear();

    // Los presupuestos de los dos espacios (CONTRACT § 0.3), no los de una constante
    // única que ya no existe. El aviso incluye de qué libro es, si no un "80% del
    // presupuesto de Servicios" no dice si es la luz de la casa o la de la oficina.
    const espaciosValidos = ESPACIOS_POR_DEFECTO.map(function (e) { return e.id; });
    const presupuestos = getAllData(getSheet(SHEETS.PRESUPUESTOS)).filter(
      (p) => p.activo && !p.eliminado && p.mes == mesActual && p.anio == anioActual &&
        espaciosValidos.indexOf(p.id_espacio) !== -1
    );
    if (!presupuestos.length) return;

    const usuariosActivos = getAllData(getSheet(SHEETS.USUARIOS)).filter((u) => u.activo);

    presupuestos.forEach((pres) => {
      try {
        const resultado = getProgresoPresupuesto(pres.id_presupuesto);
        const progreso = resultado && resultado.data;
        if (!progreso) return;

        const umbral = pres.alerta_porcentaje || 80;

        if (progreso.excedido || progreso.porcentaje >= umbral) {
          usuariosActivos.forEach((u) => {
            crearNotificacionInterna({
              id_usuario: u.id_usuario,
              tipo: 'presupuesto',
              titulo: progreso.excedido ? 'Presupuesto excedido' : 'Alerta de presupuesto',
              mensaje: 'Se usó el ' + Math.round(progreso.porcentaje) + '% del presupuesto de la categoría.',
              datos: { id_presupuesto: pres.id_presupuesto, porcentaje: progreso.porcentaje },
              canal: 'app'
            });
          });
        }
      } catch (errUno) {
        reportarSentry(errUno, { origen: 'tgTriggerPresupuestos:presupuesto', id_presupuesto: pres.id_presupuesto });
      }
    });
  } catch (err) {
    reportarSentry(err, { origen: 'tgTriggerPresupuestos' });
  }
}
