/**
 * Modo demo: llena Dexie con data de ejemplo y una sesión falsa para poder ver la
 * app completa sin backend desplegado ni OAuth configurado.
 *
 * Se activa SOLO con VITE_DEMO=true en .env.local, y además se corta en producción
 * (import.meta.env.PROD) para que no haya forma de que una build publicada arranque
 * con usuarios inventados y una sesión que el backend nunca emitió.
 *
 * No encola nada: la data queda como 'synced' y la cola vacía, así que si después
 * conectas un backend real no se te sube esta data de mentira.
 *
 * Siembra LOS DOS espacios (CONTRACT § 0.3): Familia con las 11 categorías de siempre,
 * y Telcom con las ~20 categorías agrupadas de CONTRACT § 6-bis, para que el modo demo
 * muestre de una vez todo lo nuevo — selector de espacio, anillos agrupados, solicitudes
 * de dinero y obligaciones mensuales — sin depender del backend real.
 */
import { db, ESP_FAMILIA, ESP_TELCOM, CLAVE_ESPACIO_ACTIVO } from './db';
import type {
  Categoria,
  Cuenta,
  Deuda,
  Espacio,
  ObligacionMensual,
  Sesion,
  SolicitudDinero,
  Transaccion,
  Usuario,
} from '../data/types';

// Cambiar esta clave (no el nombre 'demo_sembrado' original) es lo que fuerza un re-sembrado
// completo en navegadores que ya tenían la data de la versión de un solo espacio: la migración
// de Dexie (offline/db.ts v3) ya reasigna esa data vieja a Familia, pero sin este cambio de
// clave el sembrado se saltearía por completo y Telcom nunca aparecería con contenido.
// Subir esta clave es lo que fuerza un re-sembrado en navegadores que ya tenían data
// de demo anterior: el sembrado se saltea si la clave ya está en `meta`.
// v3: agrega el vaciado previo, para arreglar las categorías duplicadas de Familia.
const CLAVE_DEMO = 'demo_sembrado_v3';

const USUARIOS: Array<[string, string, string, 'propietario' | 'miembro']> = [
  ['USR_ana00001', 'ana@ejemplo.com', 'Ana', 'propietario'],
  ['USR_luis0001', 'luis@ejemplo.com', 'Luis', 'miembro'],
  ['USR_carla001', 'carla@ejemplo.com', 'Carla', 'miembro'],
  ['USR_diego001', 'diego@ejemplo.com', 'Diego', 'miembro'],
];

// ---------------------------------------------------------------------------------------------
// Categorías — Familia (README § 9, grupo '' porque con 11 categorías no hace falta agrupar).

const CATEGORIAS_FAMILIA_GASTO: Array<[string, string, string]> = [
  ['Comida', '🍽️', '#FF9F0A'],
  ['Transporte', '🚌', '#0A84FF'],
  ['Gastos fijos', '🏠', '#5E5CE6'],
  ['Servicios', '💡', '#64D2FF'],
  ['Salud', '🩺', '#FF453A'],
  ['Educación', '📚', '#BF5AF2'],
  ['Entretenimiento', '🎬', '#FF375F'],
  ['Otros gastos', '📦', '#86868B'],
];

const CATEGORIAS_FAMILIA_INGRESO: Array<[string, string, string]> = [
  ['Sueldo', '💼', '#30D158'],
  ['Ingresos extra', '✨', '#66D4CF'],
  ['Otros ingresos', '💰', '#A2845E'],
];

const GLOSAS_FAMILIA: Record<string, string[]> = {
  Comida: ['Metro', 'Mercado de barrio', 'Almuerzo', 'Panadería', 'Wong', 'Pollería'],
  Transporte: ['Gasolina', 'Uber al centro', 'Pasajes', 'Peaje'],
  'Gastos fijos': ['Alquiler', 'Mantenimiento edificio'],
  Servicios: ['Internet', 'Luz', 'Agua', 'Celular'],
  Salud: ['Farmacia', 'Consulta médica', 'Dentista'],
  Educación: ['Cuota universidad', 'Libros', 'Curso online'],
  Entretenimiento: ['Cine', 'Netflix', 'Salida con amigos', 'Spotify'],
  'Otros gastos': ['Regalo', 'Ferretería', 'Imprevisto'],
  Sueldo: ['Sueldo mensual'],
  'Ingresos extra': ['Trabajo freelance', 'Venta por Marketplace'],
  'Otros ingresos': ['Devolución', 'Préstamo devuelto'],
};

// ---------------------------------------------------------------------------------------------
// Categorías — Telcom (CONTRACT § 6-bis): ~20 de gasto agrupadas + 2 de ingreso.

const CATEGORIAS_TELCOM_GASTO: Array<[string, string, string, string]> = [
  // grupo 'operativos'
  ['Notaría y trámites', '📝', '#0A84FF', 'operativos'],
  ['Servicios técnicos', '🛠️', '#5E5CE6', 'operativos'],
  ['Viáticos', '🧳', '#64D2FF', 'operativos'],
  ['Pasajes y transporte', '🚌', '#0A84FF', 'operativos'],
  ['Materiales de trabajo', '📦', '#5E5CE6', 'operativos'],
  ['Combustible', '⛽', '#64D2FF', 'operativos'],
  ['Alquiler de oficina', '🏢', '#0A84FF', 'operativos'],
  ['Servicios de oficina', '💡', '#5E5CE6', 'operativos'],
  // grupo 'personal'
  ['Sueldos y honorarios', '💼', '#FF9F0A', 'personal'],
  ['Facturas de trabajadores', '🧾', '#FFD60A', 'personal'],
  ['Adelantos', '🤝', '#FF9F0A', 'personal'],
  ['CTS', '🏦', '#FFD60A', 'personal'],
  ['EsSalud', '🩺', '#FF453A', 'personal'],
  ['Seguros', '🛡️', '#FF9F0A', 'personal'],
  ['Gratificaciones', '🎁', '#FFD60A', 'personal'],
  // grupo 'activos'
  ['Muebles y enseres', '🪑', '#BF5AF2', 'activos'],
  ['Equipos de cómputo', '💻', '#5E5CE6', 'activos'],
  ['Útiles de oficina', '🖇️', '#BF5AF2', 'activos'],
  // grupo 'impuestos'
  ['Impuestos y SUNAT', '🏛️', '#FF453A', 'impuestos'],
  // sin grupo (contrato la marca con '—')
  ['Otros gastos operativos', '📋', '#86868B', ''],
];

const CATEGORIAS_TELCOM_INGRESO: Array<[string, string, string, string]> = [
  ['Servicios facturados', '🧾', '#30D158', 'ingresos'],
  ['Otros ingresos', '💰', '#66D4CF', 'ingresos'],
];

const GLOSAS_TELCOM: Record<string, string[]> = {
  'Notaría y trámites': ['Legalización de contrato', 'Trámite municipal'],
  'Servicios técnicos': ['Soporte de red', 'Mantenimiento de antena', 'Instalación de fibra'],
  Viáticos: ['Viáticos obra Comas', 'Viáticos visita cliente'],
  'Pasajes y transporte': ['Pasajes a Huancayo', 'Taxi a planta', 'Peaje carretera central'],
  'Materiales de trabajo': ['Cable UTP', 'Conectores y herramientas', 'Materiales instalación'],
  Combustible: ['Grifo camioneta', 'Combustible generador'],
  'Alquiler de oficina': ['Alquiler oficina Los Olivos'],
  'Servicios de oficina': ['Internet oficina', 'Luz oficina', 'Agua oficina'],
  'Sueldos y honorarios': ['Planilla del mes'],
  'Facturas de trabajadores': ['Recibo por honorarios - técnico', 'Recibo por honorarios - soporte'],
  Adelantos: ['Adelanto a Diego', 'Adelanto a técnico de campo'],
  CTS: ['Depósito CTS semestral'],
  EsSalud: ['Aporte EsSalud del mes'],
  Seguros: ['SOAT camioneta', 'Seguro de equipos'],
  Gratificaciones: ['Gratificación de julio'],
  'Muebles y enseres': ['Sillas de oficina', 'Escritorio'],
  'Equipos de cómputo': ['Laptop técnico', 'Router de prueba'],
  'Útiles de oficina': ['Papelería', 'Tóner impresora'],
  'Impuestos y SUNAT': ['IGV mensual', 'Renta de tercera categoría'],
  'Otros gastos operativos': ['Imprevisto de obra'],
  'Servicios facturados': ['Factura cliente Comas', 'Factura cliente Los Olivos', 'Factura mantenimiento mensual'],
  'Otros ingresos': ['Venta de equipo usado'],
};

/**
 * Generador determinista: la misma semilla da siempre la misma data, así que al
 * recargar no cambian los montos y se puede comparar una pantalla contra otra.
 */
function crearRandom(semilla: number): () => number {
  let estado = semilla;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
}

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'yyyy-MM-dd HH:mm:ss', igual formato que ahora() de offline/db.ts, pero desplazado `dias`
 * hacia atrás — para fechas de solicitudes que se ven creíbles ("hace un par de días"). */
function marcaHace(base: Date, dias: number): string {
  const d = new Date(base.getTime() - dias * 86_400_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

interface DefinicionEspacio {
  id_espacio: string;
  nombre: string;
  icono: string;
  categoriasGasto: Array<[string, string, string, string]>;
  categoriasIngreso: Array<[string, string, string, string]>;
  glosas: Record<string, string[]>;
  cuentas: Array<[string, string, string, string, number, number]>;
  prefijoCategoria: string;
}

export async function sembrarDemo(): Promise<void> {
  if (await db.meta.get(CLAVE_DEMO)) return;

  const hoy = new Date();
  const marca = hoy.toISOString().slice(0, 19).replace('T', ' ');
  const rnd = crearRandom(20260802);

  const usuarios: Usuario[] = USUARIOS.map(([id, email, nombre, rol]) => ({
    id_usuario: id,
    email,
    nombre,
    foto_perfil: '',
    google_id: '',
    telegram_chat_id: rol === 'propietario' ? '123456789' : '',
    rol_global: rol,
    moneda_principal: 'PEN',
    fecha_registro: marca,
    ultima_sesion: marca,
    activo: true,
  }));

  const espacios: Espacio[] = [
    {
      id_espacio: ESP_FAMILIA,
      nombre: 'Familia',
      descripcion: 'El gasto de la casa',
      id_propietario: 'USR_ana00001',
      icono: '🏠',
      color: '',
      fecha_creacion: marca,
      activo: true,
    },
    {
      id_espacio: ESP_TELCOM,
      nombre: 'Telcom',
      descripcion: 'La empresa',
      id_propietario: 'USR_ana00001',
      icono: '🏢',
      color: '',
      fecha_creacion: marca,
      activo: true,
    },
  ];

  const definiciones: DefinicionEspacio[] = [
    {
      id_espacio: ESP_FAMILIA,
      nombre: 'Familia',
      icono: '🏠',
      categoriasGasto: CATEGORIAS_FAMILIA_GASTO.map(([n, i, c]) => [n, i, c, '']),
      categoriasIngreso: CATEGORIAS_FAMILIA_INGRESO.map(([n, i, c]) => [n, i, c, '']),
      glosas: GLOSAS_FAMILIA,
      cuentas: [
        ['CTA_efectivo', 'Efectivo', 'efectivo', '💵', 400, 0],
        ['CTA_banco001', 'Cuenta corriente', 'banco', '🏦', 3200, 1],
        ['CTA_yape0001', 'Yape', 'billetera', '📱', 180, 2],
      ],
      prefijoCategoria: 'CAT_FAM',
    },
    {
      id_espacio: ESP_TELCOM,
      nombre: 'Telcom',
      icono: '🏢',
      categoriasGasto: CATEGORIAS_TELCOM_GASTO,
      categoriasIngreso: CATEGORIAS_TELCOM_INGRESO,
      glosas: GLOSAS_TELCOM,
      cuentas: [
        ['CTA_tel_banco', 'Cuenta corriente empresa', 'banco', '🏦', 18500, 0],
        ['CTA_tel_caja', 'Caja chica', 'efectivo', '💵', 850, 1],
      ],
      prefijoCategoria: 'CAT_TEL',
    },
  ];

  const categorias: Categoria[] = [];
  const cuentas: Cuenta[] = [];
  const transacciones: Transaccion[] = [];
  let n = 0;

  for (const espacio of definiciones) {
    const catsGasto: Categoria[] = espacio.categoriasGasto.map(([nombre, icono, color, grupo], i) => ({
      id_categoria: `${espacio.prefijoCategoria}_G${String(i).padStart(3, '0')}`,
      id_espacio: espacio.id_espacio,
      nombre,
      tipo: 'gasto' as const,
      icono,
      color,
      es_sistema: true,
      grupo,
      orden: i,
      activo: true,
    }));
    const catsIngreso: Categoria[] = espacio.categoriasIngreso.map(([nombre, icono, color, grupo], i) => ({
      id_categoria: `${espacio.prefijoCategoria}_I${String(i).padStart(3, '0')}`,
      id_espacio: espacio.id_espacio,
      nombre,
      tipo: 'ingreso' as const,
      icono,
      color,
      es_sistema: true,
      grupo,
      orden: i + 100,
      activo: true,
    }));
    categorias.push(...catsGasto, ...catsIngreso);

    const cuentasEspacio: Cuenta[] = espacio.cuentas.map(([id, nombre, tipo, icono, saldo, orden]) => ({
      id_cuenta: id,
      id_espacio: espacio.id_espacio,
      nombre,
      tipo,
      saldo_inicial: saldo,
      moneda: 'PEN',
      color: '#0A84FF',
      icono,
      incluir_total: true,
      orden,
      activo: true,
      fecha_creacion: marca,
    }));
    cuentas.push(...cuentasEspacio);

    // Seis meses hacia atrás desde hoy, para que la tendencia tenga con qué dibujarse.
    for (let atras = 5; atras >= 0; atras--) {
      const base = new Date(hoy.getFullYear(), hoy.getMonth() - atras, 1);
      const diasDelMes = atras === 0 ? hoy.getDate() : new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();

      if (espacio.id_espacio === ESP_FAMILIA) {
        // Un sueldo por persona a principio de mes.
        for (const u of usuarios.slice(0, 2)) {
          transacciones.push(
            nuevaTransaccion({
              id: `TRX_${String(n++).padStart(8, '0')}`,
              espacio: espacio.id_espacio,
              usuario: u.id_usuario,
              cuenta: 'CTA_banco001',
              categoria: catsIngreso[0].id_categoria,
              tipo: 'ingreso',
              monto: u.id_usuario === 'USR_ana00001' ? 4200 : 3100,
              descripcion: 'Sueldo mensual',
              fecha: fechaISO(new Date(base.getFullYear(), base.getMonth(), 2)),
              marca,
            }),
          );
        }
      } else {
        // Telcom: dos o tres facturas de servicios a clientes por mes en vez de un sueldo fijo.
        const facturas = 2 + Math.floor(rnd() * 2);
        for (let f = 0; f < facturas; f++) {
          const glosasIngreso = espacio.glosas['Servicios facturados'] ?? ['Factura cliente'];
          transacciones.push(
            nuevaTransaccion({
              id: `TRX_${String(n++).padStart(8, '0')}`,
              espacio: espacio.id_espacio,
              usuario: usuarios[0].id_usuario,
              cuenta: 'CTA_tel_banco',
              categoria: catsIngreso[0].id_categoria,
              tipo: 'ingreso',
              monto: Math.round((2200 + rnd() * 3800) * 100) / 100,
              descripcion: glosasIngreso[f % glosasIngreso.length],
              fecha: fechaISO(new Date(base.getFullYear(), base.getMonth(), 3 + f * 8)),
              marca,
            }),
          );
        }
      }

      const cuantos = espacio.id_espacio === ESP_FAMILIA ? 18 + Math.floor(rnd() * 10) : 24 + Math.floor(rnd() * 14);
      for (let k = 0; k < cuantos; k++) {
        const cat = catsGasto[Math.floor(rnd() * catsGasto.length)];
        const glosas = espacio.glosas[cat.nombre] ?? ['Gasto'];
        const dia = 1 + Math.floor(rnd() * diasDelMes);
        const usuario = usuarios[Math.floor(rnd() * usuarios.length)];
        const cuenta = cuentasEspacio[Math.floor(rnd() * cuentasEspacio.length)];
        const montoBase =
          espacio.id_espacio === ESP_FAMILIA
            ? 8 + rnd() * (cat.nombre === 'Gastos fijos' ? 1400 : 180)
            : 40 + rnd() * (cat.grupo === 'personal' ? 1600 : cat.grupo === 'activos' ? 900 : 320);

        transacciones.push(
          nuevaTransaccion({
            id: `TRX_${String(n++).padStart(8, '0')}`,
            espacio: espacio.id_espacio,
            usuario: usuario.id_usuario,
            cuenta: cuenta.id_cuenta,
            categoria: cat.id_categoria,
            tipo: 'gasto',
            monto: Math.round(montoBase * 100) / 100,
            descripcion: glosas[Math.floor(rnd() * glosas.length)],
            fecha: fechaISO(new Date(base.getFullYear(), base.getMonth(), dia)),
            marca,
            // Un par del mes en curso quedan pendientes de sincronizar, para ver el indicador.
            pendiente: atras === 0 && k < 2,
            // Uno entra por foto de voucher, como los que manda el bot.
            origen: k === 3 ? 'bot_foto' : k === 6 ? 'bot_texto' : 'app',
          }),
        );
      }
    }
  }

  const enDias = (d: number) => fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + d));

  const deudas: Deuda[] = (
    [
      [ESP_FAMILIA, 'DDA_00000001', 'USR_ana00001', 'me_deben', 'Luis', 320, 320, 'Entradas del concierto', 12, 'pendiente'],
      [ESP_FAMILIA, 'DDA_00000002', 'USR_luis0001', 'debo', 'Carla', 150, 60, 'Mitad del regalo de mamá', 2, 'pendiente'],
      [ESP_FAMILIA, 'DDA_00000003', 'USR_carla001', 'debo', 'Ferretería del barrio', 480, 480, 'Materiales de la reparación', -4, 'vencida'],
      [ESP_FAMILIA, 'DDA_00000004', 'USR_ana00001', 'me_deben', 'Diego', 200, 0, 'Adelanto del alquiler', -20, 'pagada'],
      [ESP_TELCOM, 'DDA_00000005', 'USR_ana00001', 'debo', 'SUNAT', 2100, 2100, 'IGV pendiente de regularización', 6, 'pendiente'],
      [ESP_TELCOM, 'DDA_00000006', 'USR_ana00001', 'me_deben', 'Cliente Los Olivos SAC', 3600, 3600, 'Factura de mantenimiento de julio', 9, 'pendiente'],
    ] as const
  ).map(([espacio, id, usuario, tipo, persona, original, pendiente, desc, dias, estado]) => ({
    id_deuda: id,
    id_espacio: espacio,
    id_usuario: usuario,
    tipo: tipo as Deuda['tipo'],
    persona,
    monto_original: original,
    monto_pendiente: pendiente,
    descripcion: desc,
    fecha_creacion: marca,
    fecha_vencimiento: enDias(dias),
    estado: estado as Deuda['estado'],
    recordatorio: true,
    notas: '',
    rev: 1,
    origen: 'app' as const,
    eliminado: false,
    sync_status: 'synced' as const,
  }));

  const catTelcomPorNombre = new Map(categorias.filter((c) => c.id_espacio === ESP_TELCOM).map((c) => [c.nombre, c]));
  const catFamiliaPorNombre = new Map(categorias.filter((c) => c.id_espacio === ESP_FAMILIA).map((c) => [c.nombre, c]));

  const solicitudes: SolicitudDinero[] = [
    {
      id_solicitud: 'SOL_00000001',
      id_espacio: ESP_TELCOM,
      id_solicitante: 'USR_diego001',
      monto: 350,
      motivo: 'Materiales para la instalación en Comas',
      id_categoria: catTelcomPorNombre.get('Materiales de trabajo')?.id_categoria ?? '',
      estado: 'solicitada',
      id_aprobador: '',
      fecha_solicitud: marcaHace(hoy, 1),
      fecha_respuesta: '',
      id_transaccion: '',
      notas: '',
      eliminado: false,
      fecha_modificacion: marcaHace(hoy, 1),
    },
    {
      id_solicitud: 'SOL_00000002',
      id_espacio: ESP_TELCOM,
      id_solicitante: 'USR_carla001',
      monto: 120,
      motivo: 'Pasajes a Huancayo para visita técnica',
      id_categoria: catTelcomPorNombre.get('Pasajes y transporte')?.id_categoria ?? '',
      estado: 'aprobada',
      id_aprobador: 'USR_ana00001',
      fecha_solicitud: marcaHace(hoy, 5),
      fecha_respuesta: marcaHace(hoy, 4),
      id_transaccion: '',
      notas: '',
      eliminado: false,
      fecha_modificacion: marcaHace(hoy, 4),
    },
    {
      id_solicitud: 'SOL_00000003',
      id_espacio: ESP_FAMILIA,
      id_solicitante: 'USR_luis0001',
      monto: 80,
      motivo: 'Adelanto para el techo que gotea',
      id_categoria: catFamiliaPorNombre.get('Gastos fijos')?.id_categoria ?? '',
      estado: 'rechazada',
      id_aprobador: 'USR_ana00001',
      fecha_solicitud: marcaHace(hoy, 3),
      fecha_respuesta: marcaHace(hoy, 2),
      id_transaccion: '',
      notas: 'Ya se cubrió con el fondo común de la casa.',
      eliminado: false,
      fecha_modificacion: marcaHace(hoy, 2),
    },
  ];

  const periodoActual = marca.slice(0, 7); // 'yyyy-MM'
  const cuentaTelcomBanco = 'CTA_tel_banco';
  const cuentaFamiliaBanco = 'CTA_banco001';

  const obligaciones: ObligacionMensual[] = [
    {
      id_obligacion: 'OBL_00000001',
      id_espacio: ESP_TELCOM,
      concepto: 'Alquiler de oficina',
      id_categoria: catTelcomPorNombre.get('Alquiler de oficina')?.id_categoria ?? '',
      id_cuenta: cuentaTelcomBanco,
      monto_estimado: 1800,
      dia_vencimiento: 5,
      ultimo_periodo_generado: periodoActual,
      activo: true,
      notas: '',
      fecha_creacion: marca,
      eliminado: false,
      fecha_modificacion: marca,
    },
    {
      id_obligacion: 'OBL_00000002',
      id_espacio: ESP_TELCOM,
      concepto: 'EsSalud de planilla',
      id_categoria: catTelcomPorNombre.get('EsSalud')?.id_categoria ?? '',
      id_cuenta: cuentaTelcomBanco,
      monto_estimado: 620,
      dia_vencimiento: 15,
      ultimo_periodo_generado: periodoActual,
      activo: true,
      notas: '',
      fecha_creacion: marca,
      eliminado: false,
      fecha_modificacion: marca,
    },
    {
      id_obligacion: 'OBL_00000003',
      id_espacio: ESP_TELCOM,
      concepto: 'CTS',
      id_categoria: catTelcomPorNombre.get('CTS')?.id_categoria ?? '',
      id_cuenta: cuentaTelcomBanco,
      monto_estimado: 950,
      dia_vencimiento: 30,
      // Todavía no se generó la deuda de este mes: se ve el estado "pendiente de generar".
      ultimo_periodo_generado: '',
      activo: true,
      notas: 'Depósito semestral, se prorratea mes a mes.',
      fecha_creacion: marca,
      eliminado: false,
      fecha_modificacion: marca,
    },
    {
      id_obligacion: 'OBL_00000004',
      id_espacio: ESP_FAMILIA,
      concepto: 'Alquiler de la casa',
      id_categoria: catFamiliaPorNombre.get('Gastos fijos')?.id_categoria ?? '',
      id_cuenta: cuentaFamiliaBanco,
      monto_estimado: 1200,
      dia_vencimiento: 3,
      ultimo_periodo_generado: periodoActual,
      activo: true,
      notas: '',
      fecha_creacion: marca,
      eliminado: false,
      fecha_modificacion: marca,
    },
  ];

  const sesion: Sesion = {
    usuario: usuarios[0], // Ana, propietaria: así se ve también la pestaña Administración.
    token_sesion: 'demo-sin-backend',
    expira: new Date(Date.now() + 12 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' '),
  };

  await db.transaction(
    'rw',
    [
      db.usuarios,
      db.espacios,
      db.categorias,
      db.cuentas,
      db.transacciones,
      db.deudas,
      db.solicitudes,
      db.obligaciones,
      db.sesion,
      db.meta,
    ],
    async () => {
      // Vaciar antes de sembrar. Sin esto, un navegador que ya tenía la data de la
      // versión de un solo espacio termina con DOS juegos de categorías de Familia:
      // el viejo, que la migración de Dexie reasignó a Familia con sus ids originales,
      // y el nuevo, con ids distintos. En el selector se ven "Comida, Comida,
      // Transporte, Transporte...". Es data de demo: se reemplaza entera, no se fusiona.
      await Promise.all([
        db.usuarios.clear(),
        db.espacios.clear(),
        db.categorias.clear(),
        db.cuentas.clear(),
        db.transacciones.clear(),
        db.deudas.clear(),
        db.solicitudes.clear(),
        db.obligaciones.clear(),
      ]);

      await db.usuarios.bulkPut(usuarios);
      await db.espacios.bulkPut(espacios);
      await db.categorias.bulkPut(categorias);
      await db.cuentas.bulkPut(cuentas);
      await db.transacciones.bulkPut(transacciones);
      await db.deudas.bulkPut(deudas);
      await db.solicitudes.bulkPut(solicitudes);
      await db.obligaciones.bulkPut(obligaciones);
      await db.sesion.put({ clave: 'actual', valor: sesion });
      await db.meta.put({ clave: CLAVE_ESPACIO_ACTIVO, valor: ESP_FAMILIA });
      await db.meta.put({ clave: CLAVE_DEMO, valor: marca });
    },
  );
}

function nuevaTransaccion(a: {
  id: string;
  espacio: string;
  usuario: string;
  cuenta: string;
  categoria: string;
  tipo: 'gasto' | 'ingreso';
  monto: number;
  descripcion: string;
  fecha: string;
  marca: string;
  pendiente?: boolean;
  origen?: Transaccion['origen'];
}): Transaccion {
  return {
    id_transaccion: a.id,
    id_espacio: a.espacio,
    id_usuario: a.usuario,
    id_cuenta: a.cuenta,
    id_categoria: a.categoria,
    tipo: a.tipo,
    monto: a.monto,
    descripcion: a.descripcion,
    fecha: a.fecha,
    hora: '12:00:00',
    ubicacion: '',
    notas: '',
    rev: 1,
    origen: a.origen ?? 'app',
    eliminado: false,
    fecha_creacion: a.marca,
    fecha_modificacion: a.marca,
    sync_status: a.pendiente ? 'pending' : 'synced',
  };
}
