/**
 * 94_importar_empresa.js — carga inicial de los datos reales de Telcom (docs/DESPLIEGUE.md § 7).
 *
 * Trabajadores (con DNI y sueldo), planilla programada, obligaciones SUNAT, deudas abiertas y
 * cuentas. Los datos NO están en el código (el repositorio es público): se pegan como JSON en la
 * propiedad del script `DATOS_IMPORTAR`, y la función la borra al terminar.
 *
 * Idempotente: trabajadores por DNI, obligaciones por concepto, deudas por persona+descripción,
 * cuentas por nombre. Correrla dos veces no duplica nada.
 *
 * Al final genera las deudas del mes de las obligaciones nuevas (generarObligacionesDelMes), así
 * la planilla y la PLAME aparecen de inmediato como "por pagar".
 */

var IMP_ESPACIO = 'ESP_TELCOM';

function imp_buscar(filas, pred) {
  for (var i = 0; i < filas.length; i++) if (pred(filas[i])) return filas[i];
  return null;
}

function importarDatosEmpresa() {
  var props = PropertiesService.getScriptProperties();
  var texto = props.getProperty('DATOS_IMPORTAR');
  if (!texto) throw new Error('Falta la propiedad DATOS_IMPORTAR (el JSON que te preparó Claude). Cárgala y vuelve a ejecutar.');

  var datos;
  try {
    datos = JSON.parse(texto);
  } catch (e) {
    throw new Error('DATOS_IMPORTAR no es JSON válido: ' + e.message + '. Pégalo completo, sin cortar.');
  }

  var log = [];
  try {
    withLock(function () {
      var ahora = fechaHoraActual();
      var categorias = getAllData(getSheet(SHEETS.CATEGORIAS)).filter(function (c) { return c.id_espacio === IMP_ESPACIO && c.activo; });
      var idCategoria = function (nombre) {
        var c = imp_buscar(categorias, function (x) { return x.nombre === nombre; });
        if (!c) throw new Error('No existe la categoría "' + nombre + '" en Telcom. Ejecuta inicializarSistema primero.');
        return c.id_categoria;
      };

      // ---- Cuentas
      var cuentasSheet = getSheet(SHEETS.CUENTAS);
      var cuentas = getAllData(cuentasSheet).filter(function (c) { return c.id_espacio === IMP_ESPACIO && c.activo; });
      (datos.cuentas || []).forEach(function (c, i) {
        if (imp_buscar(cuentas, function (x) { return x.nombre === c.nombre; })) return;
        var nueva = {
          id_cuenta: generateId('CTA'), id_espacio: IMP_ESPACIO, nombre: sanearTexto(c.nombre, 100), tipo: c.tipo || 'banco',
          saldo_inicial: 0, moneda: 'PEN', color: '#FFA53D', icono: c.icono || '🏦', incluir_total: true,
          orden: 10 + i, activo: true, fecha_creacion: ahora
        };
        anexarFila(cuentasSheet, nueva);
        cuentas.push(nueva);
        log.push('Cuenta creada: ' + c.nombre);
      });
      // Las obligaciones salen de la primera cuenta bancaria (la corriente de la empresa).
      var cuentaPago = imp_buscar(cuentas, function (x) { return x.tipo === 'banco'; }) || cuentas[0];
      if (!cuentaPago) throw new Error('Telcom no tiene cuentas. Ejecuta inicializarSistema primero.');

      // ---- Trabajadores
      var trabSheet = getSheet(SHEETS.TRABAJADORES);
      var trabajadores = getAllData(trabSheet).filter(function (t) { return t.id_espacio === IMP_ESPACIO; });
      var usuarios = getAllData(getSheet(SHEETS.USUARIOS));
      (datos.trabajadores || []).forEach(function (t) {
        var prep = trb_preparar(t, false);
        if (!prep.valido) throw new Error('Trabajador "' + t.nombre + '": ' + prep.detalle);
        var d = prep.datos;
        var enlace = imp_buscar(datos.usuarios || [], function (u) { return u.documento && u.documento === t.documento; });
        var usuario = enlace ? imp_buscar(usuarios, function (u) { return String(u.usuario || '') === enlace.usuario; }) : null;
        var existente = t.documento ? imp_buscar(trabajadores, function (x) { return String(x.documento) === String(t.documento); }) : null;
        if (existente) {
          if (usuario && !existente.id_usuario) {
            var fila = buscarPorId(trabSheet, 'id_trabajador', existente.id_trabajador);
            escribirCampos(trabSheet, fila.row, fila.headers, { id_usuario: usuario.id_usuario, fecha_modificacion: ahora }, ['id_trabajador']);
            existente.id_usuario = usuario.id_usuario;
          }
          log.push('Trabajador ya existía: ' + t.nombre);
          return;
        }
        var obj = {
          id_trabajador: generateId('TRB'), id_espacio: IMP_ESPACIO, nombre: d.nombre, documento: d.documento || '',
          tipo_vinculo: d.tipo_vinculo || 'planilla', cargo: d.cargo || '', proyecto: d.proyecto || '', sueldo_base: d.sueldo_base || 0,
          pension: d.pension || '', fecha_ingreso: d.fecha_ingreso || '', fecha_fin: d.fecha_fin || '',
          id_usuario: usuario ? usuario.id_usuario : '', activo: true, notas: d.notas || '', fecha_creacion: ahora, fecha_modificacion: ahora
        };
        anexarFila(trabSheet, obj);
        trabajadores.push(obj);
        log.push('Trabajador creado: ' + t.nombre + (usuario ? ' (vinculado a ' + usuario.usuario + ')' : ''));
      });

      // ---- Obligaciones: planilla de cada trabajador con sueldo + las de la empresa
      var oblSheet = getSheet(SHEETS.OBLIGACIONES_MENSUALES);
      var obligaciones = getAllData(oblSheet).filter(function (o) { return o.id_espacio === IMP_ESPACIO && !o.eliminado; });
      var crearObligacion = function (o) {
        if (imp_buscar(obligaciones, function (x) { return x.concepto === o.concepto; })) { log.push('Obligación ya existía: ' + o.concepto); return; }
        var obj = {
          id_obligacion: generateId('OBL'), id_espacio: IMP_ESPACIO, concepto: sanearTexto(o.concepto, 200), id_categoria: idCategoria(o.categoria),
          id_cuenta: cuentaPago.id_cuenta, monto_estimado: o.monto, dia_vencimiento: o.dia, ultimo_periodo_generado: '', activo: true,
          notas: sanearTexto(o.notas || '', 500), fecha_creacion: ahora, eliminado: false, fecha_modificacion: ahora, id_trabajador: o.id_trabajador || ''
        };
        anexarFila(oblSheet, obj);
        obligaciones.push(obj);
        log.push('Obligación creada: ' + o.concepto + ' · S/ ' + o.monto + ' · día ' + o.dia);
      };
      var plan = datos.planilla_programada;
      if (plan) {
        trabajadores.forEach(function (t) {
          if (!t.activo || !(parseFloat(t.sueldo_base) > 0)) return;
          crearObligacion({
            concepto: (t.tipo_vinculo === 'honorarios' ? 'Honorarios ' : 'Sueldo ') + t.nombre,
            categoria: plan.categoria, monto: parseFloat(t.sueldo_base), dia: plan.dia_vencimiento, notas: plan.notas, id_trabajador: t.id_trabajador
          });
        });
      }
      (datos.obligaciones || []).forEach(function (o) {
        crearObligacion({ concepto: o.concepto, categoria: o.categoria, monto: o.monto_estimado, dia: o.dia_vencimiento, notas: o.notas });
      });

      // ---- Préstamos de cuota fija (cronograma desconocido): cabecera + obligación + cuota pendiente
      var prsSheet = getSheet(SHEETS.PRESTAMOS);
      var prestamos = getAllData(prsSheet).filter(function (x) { return x.id_espacio === IMP_ESPACIO; });
      (datos.prestamos || []).forEach(function (pr) {
        if (imp_buscar(prestamos, function (x) { return x.entidad === pr.entidad && x.descripcion === pr.descripcion; })) { log.push('Préstamo ya existía: ' + pr.descripcion); return; }
        var prep = prs_preparar({ id_espacio: IMP_ESPACIO, entidad: pr.entidad, descripcion: pr.descripcion, modalidad: 'cuota_fija', cuota_mensual: pr.cuota, dia_pago: pr.dia_pago, id_cuenta: cuentaPago.id_cuenta, notas: pr.notas }, true);
        if (!prep.valido) throw new Error('Préstamo ' + pr.descripcion + ': ' + prep.detalle);
        var d = prep.datos;
        var cab = {
          id_prestamo: generateId('PRS'), id_espacio: IMP_ESPACIO, entidad: d.entidad, tipo: 'prestamo', descripcion: d.descripcion || '',
          monto: 0, tea: 0, plazo: '', dia_pago: d.dia_pago, fecha_desembolso: '', id_cuenta: d.id_cuenta, activo: true,
          notas: d.notas || '', fecha_creacion: ahora, fecha_modificacion: ahora, modalidad: 'cuota_fija', cuota_mensual: d.cuota_mensual, fecha_fin: ''
        };
        anexarFila(prsSheet, cab);
        prestamos.push(cab);
        // La cuota pendiente que se ve hoy en el banco; el trigger sigue desde el mes siguiente.
        crearDeudaInterna({
          id_espacio: IMP_ESPACIO, id_usuario: '', tipo: 'debo', persona: pr.entidad, monto_original: pr.cuota,
          descripcion: pr.descripcion + ' · cuota', fecha_vencimiento: pr.proximo_vencimiento, recordatorio: true, origen: 'app',
          notas: pr.notas || '', id_prestamo: cab.id_prestamo
        }, null);
        prs_crearObligacion(cab, String(pr.proximo_vencimiento).slice(0, 7));
        log.push('Préstamo cuota fija: ' + pr.entidad + ' · ' + pr.descripcion + ' · S/ ' + pr.cuota + ' el día ' + pr.dia_pago);
      });

      // ---- Deudas abiertas (SUNAT, etc.)
      var deudasSheet = getSheet(SHEETS.DEUDAS);
      var deudas = getAllData(deudasSheet).filter(function (d) { return d.id_espacio === IMP_ESPACIO && !d.eliminado; });
      (datos.deudas || []).forEach(function (d) {
        if (imp_buscar(deudas, function (x) { return x.persona === d.persona && x.descripcion === d.descripcion; })) { log.push('Deuda ya existía: ' + d.descripcion); return; }
        var creada = crearDeudaInterna({
          id_espacio: IMP_ESPACIO, id_usuario: '', tipo: d.tipo, persona: d.persona, monto_original: d.monto,
          descripcion: d.descripcion, fecha_vencimiento: d.vence, recordatorio: true, origen: 'app', notas: 'Importada de la bóveda INGENERIA TELCOM'
        }, null);
        deudas.push(creada);
        log.push('Deuda creada: ' + d.persona + ' · S/ ' + d.monto + ' · ' + d.descripcion);
      });
    });
  } finally {
    // Pase lo que pase, los DNI y sueldos no se quedan guardados en las propiedades.
    props.deleteProperty('DATOS_IMPORTAR');
  }

  // Fuera del lock de arriba: generarObligacionesDelMes toma el suyo.
  var gen = generarObligacionesDelMes();
  log.push('Deudas del mes generadas: ' + ((gen.data && gen.data.generadas) || []).length);
  log.push('DATOS_IMPORTAR borrada.');
  Logger.log(log.join('\n'));
  return log;
}
