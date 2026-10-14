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
  Trabajador,
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
// v4: trabajadores (CONTRACT § 4-quater) con pagos, un adelanto y una planilla programada.
// v7: categorías financieras de préstamos; además vacía la cola y los conflictos locales.
const CLAVE_DEMO = 'demo_sembrado_v10';
const FINANCIERAS = new Set(['Intereses y comisiones bancarias', 'Amortización de préstamos', 'Préstamos recibidos']);

/**
 * Data real de la empresa en ../datos-locales/telcom.json (carpeta en .gitignore: DNI y sueldos
 * no viajan al repo). Si existe, Telcom se siembra con los trabajadores, obligaciones y deudas
 * reales en vez de los inventados. El glob devuelve {} si el archivo no está, sin romper nada.
 */
interface DatosLocalesTelcom {
  trabajadores: Array<Pick<Trabajador, 'nombre' | 'documento' | 'tipo_vinculo' | 'cargo' | 'proyecto' | 'sueldo_base' | 'pension' | 'fecha_ingreso' | 'fecha_fin' | 'notas'>>;
  obligaciones: Array<{ concepto: string; categoria: string; monto_estimado: number; dia_vencimiento: number; notas: string }>;
  planilla_programada: { categoria: string; dia_vencimiento: number; notas: string };
  deudas: Array<{ tipo: Deuda['tipo']; persona: string; monto: number; descripcion: string; vence: string }>;
  /** El equipo real. Sin contraseñas: en demo no hay login; en producción las crea crearCuentasEquipo(). */
  usuarios?: Array<{ id: string; usuario: string; nombre: string; email: string; rol: 'propietario' | 'miembro'; documento: string }>;
  cuentas_telcom?: Array<{ nombre: string; tipo: string; icono: string }>;
}
const DATOS_LOCALES = Object.values(
  import.meta.glob<DatosLocalesTelcom>('../../../datos-locales/telcom.json', { eager: true, import: 'default' }),
)[0];

/** Gente inventada a propósito: el repo es público y la planilla real no va acá. */
const TRABAJADORES_DEMO: Array<[string, string, Trabajador['tipo_vinculo'], string, number, string, string]> = [
  // id, nombre, vínculo, cargo, sueldo, fecha_ingreso, fecha_fin
  ['TRB_demo0001', 'Rosa Quispe', 'planilla', 'Coordinadora', 3200, '2026-03-01', '2026-12-31'],
  ['TRB_demo0002', 'Jorge Mamani', 'planilla', 'Técnico de campo', 1800, '2026-05-15', '2026-12-31'],
  ['TRB_demo0003', 'Lucía Torres', 'planilla', 'Asistente administrativa', 1500, '2026-01-10', ''],
  ['TRB_demo0004', 'Mario Huamán', 'honorarios', 'Apoyo legal', 1000, '2026-08-20', ''],
];

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
  ['Intereses y comisiones bancarias', '🏦', '#FF453A'],
  ['Amortización de préstamos', '📉', '#8E8E93'],
];

const CATEGORIAS_FAMILIA_INGRESO: Array<[string, string, string]> = [
  ['Sueldo', '💼', '#30D158'],
  ['Ingresos extra', '✨', '#66D4CF'],
  ['Otros ingresos', '💰', '#A2845E'],
  ['Préstamos recibidos', '🏦', '#0A84FF'],
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
  ['Intereses y comisiones bancarias', '🏦', '#FF453A', 'financiero'],
  ['Amortización de préstamos', '📉', '#8E8E93', 'financiero'],
  ['Otros gastos operativos', '📋', '#86868B', ''],
];

const CATEGORIAS_TELCOM_INGRESO: Array<[string, string, string, string]> = [
  ['Servicios facturados', '🧾', '#30D158', 'ingresos'],
  ['Otros ingresos', '💰', '#66D4CF', 'ingresos'],
  ['Préstamos recibidos', '🏦', '#0A84FF', 'financiero'],
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
        // Los gastos inventados nunca caen en préstamos: eso solo nace de un cronograma real.
        const aleatorias = catsGasto.filter((c) => !FINANCIERAS.has(c.nombre));
        const cat = aleatorias[Math.floor(rnd() * aleatorias.length)];
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

  const trabajadores: Trabajador[] = DATOS_LOCALES
    ? DATOS_LOCALES.trabajadores.map((t, i) => ({
        ...t,
        id_trabajador: `TRB_real${String(i).padStart(4, '0')}`,
        id_espacio: ESP_TELCOM,
        id_usuario: '',
        activo: true,
        fecha_creacion: marca,
        fecha_modificacion: marca,
      }))
    : TRABAJADORES_DEMO.map(([id, nombre, tipo_vinculo, cargo, sueldo, ingreso, fin]) => ({
    id_trabajador: id,
    id_espacio: ESP_TELCOM,
    nombre,
    documento: '',
    tipo_vinculo,
    cargo,
    proyecto: 'Contrato demo',
    sueldo_base: sueldo,
    pension: tipo_vinculo === 'planilla' ? 'ONP' : '',
    fecha_ingreso: ingreso,
    fecha_fin: id === 'TRB_demo0004' ? enDias(25) : fin,
    id_usuario: '',
    activo: true,
    notas: '',
    fecha_creacion: marca,
    fecha_modificacion: marca,
  }));

  // Los gastos de personal de Telcom se reparten entre los trabajadores. Uno del mes en curso
  // queda sin asignar para que se vea el aviso de "pagos sin trabajador".
  const personalTelcom = new Set(
    categorias.filter((c) => c.id_espacio === ESP_TELCOM && c.grupo === 'personal').map((c) => c.id_categoria),
  );
  const mesActual = marca.slice(0, 7);
  let sinAsignarDejado = false;
  let turno = 0;
  for (const t of transacciones) {
    if (!personalTelcom.has(t.id_categoria)) continue;
    if (DATOS_LOCALES) continue;
    if (!sinAsignarDejado && t.fecha.startsWith(mesActual)) {
      sinAsignarDejado = true;
      continue;
    }
    t.id_trabajador = trabajadores[turno++ % trabajadores.length].id_trabajador;
  }
  // Con la planilla real no quedan pagos de personal inventados: ni atribuidos a personas reales,
  // ni sueltos inflando el costo de personal (y CTS/gratificaciones no aplican en REMYPE).
  if (DATOS_LOCALES) {
    const sinPersonal = transacciones.filter((t) => !personalTelcom.has(t.id_categoria));
    transacciones.splice(0, transacciones.length, ...sinPersonal);
  }

  const deudas: Deuda[] = (
    [
      [ESP_FAMILIA, 'DDA_00000001', 'USR_ana00001', 'me_deben', 'Luis', 320, 320, 'Entradas del concierto', 12, 'pendiente'],
      [ESP_FAMILIA, 'DDA_00000002', 'USR_luis0001', 'debo', 'Carla', 150, 60, 'Mitad del regalo de mamá', 2, 'pendiente'],
      [ESP_FAMILIA, 'DDA_00000003', 'USR_carla001', 'debo', 'Ferretería del barrio', 480, 480, 'Materiales de la reparación', -4, 'vencida'],
      [ESP_FAMILIA, 'DDA_00000004', 'USR_ana00001', 'me_deben', 'Diego', 200, 0, 'Adelanto del alquiler', -20, 'pagada'],
      [ESP_TELCOM, 'DDA_00000005', 'USR_ana00001', 'debo', 'SUNAT', 2100, 2100, 'IGV pendiente de regularización', 6, 'pendiente'],
      [ESP_TELCOM, 'DDA_00000006', 'USR_ana00001', 'me_deben', 'Cliente Los Olivos SAC', 3600, 3600, 'Factura de mantenimiento de julio', 9, 'pendiente'],
      [ESP_TELCOM, 'DDA_00000007', 'USR_ana00001', 'me_deben', 'Jorge Mamani', 300, 300, 'Adelanto por descontar: pasajes de su familia', 16, 'pendiente'],
      [ESP_TELCOM, 'DDA_00000008', '', 'debo', 'Sueldo Rosa Quispe', 3200, 3200, 'Obligación mensual: Sueldo Rosa Quispe', 17, 'pendiente'],
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
    id_trabajador: id === 'DDA_00000007' ? 'TRB_demo0002' : id === 'DDA_00000008' ? 'TRB_demo0001' : '',
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
      id_obligacion: 'OBL_00000005',
      id_espacio: ESP_TELCOM,
      concepto: 'Sueldo Rosa Quispe',
      id_categoria: catTelcomPorNombre.get('Sueldos y honorarios')?.id_categoria ?? '',
      id_cuenta: cuentaTelcomBanco,
      monto_estimado: 3200,
      dia_vencimiento: 30,
      ultimo_periodo_generado: periodoActual,
      activo: true,
      notas: '',
      fecha_creacion: marca,
      eliminado: false,
      fecha_modificacion: marca,
      id_trabajador: 'TRB_demo0001',
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

  if (DATOS_LOCALES) {
    // Lo de Telcom inventado (deudas y obligaciones de ejemplo) se reemplaza por lo real.
    const soloFamilia = <T extends { id_espacio: string }>(filas: T[]) => filas.filter((f) => f.id_espacio !== ESP_TELCOM);
    deudas.splice(0, deudas.length, ...soloFamilia(deudas));
    obligaciones.splice(0, obligaciones.length, ...soloFamilia(obligaciones));

    const plan = DATOS_LOCALES.planilla_programada;
    const idCat = (nombre: string) => catTelcomPorNombre.get(nombre)?.id_categoria ?? '';
    const venceEsteMes = (dia: number) => {
      const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
      return fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), Math.min(dia, ultimo)));
    };
    let k = 0;
    const obligacionReal = (o: { concepto: string; categoria: string; monto: number; dia: number; notas: string; id_trabajador?: string }) => {
      const id = `OBL_real${String(k++).padStart(4, '0')}`;
      obligaciones.push({
        id_obligacion: id,
        id_espacio: ESP_TELCOM,
        concepto: o.concepto,
        id_categoria: idCat(o.categoria),
        id_cuenta: cuentaTelcomBanco,
        monto_estimado: o.monto,
        dia_vencimiento: o.dia,
        ultimo_periodo_generado: periodoActual,
        activo: true,
        notas: o.notas,
        fecha_creacion: marca,
        eliminado: false,
        fecha_modificacion: marca,
        id_trabajador: o.id_trabajador ?? '',
      });
      // La deuda de este mes, como la generaría el trigger (backend/24_obligaciones.js).
      deudas.push(deudaReal('debo', o.concepto, o.monto, `Obligación mensual: ${o.concepto}`, venceEsteMes(o.dia), o.id_trabajador));
    };
    const deudaReal = (tipo: Deuda['tipo'], persona: string, monto: number, descripcion: string, vence: string, idTrabajador = ''): Deuda => ({
      id_deuda: `DDA_real${String(deudas.length).padStart(4, '0')}`,
      id_espacio: ESP_TELCOM,
      id_usuario: '',
      tipo,
      persona,
      monto_original: monto,
      monto_pendiente: monto,
      descripcion,
      fecha_creacion: marca,
      fecha_vencimiento: vence,
      estado: vence < fechaISO(hoy) ? 'vencida' : 'pendiente',
      recordatorio: true,
      notas: '',
      rev: 1,
      origen: 'app',
      eliminado: false,
      id_trabajador: idTrabajador,
      sync_status: 'synced',
    });

    for (const t of trabajadores) {
      if (!t.sueldo_base) continue; // Sin sueldo confirmado no se programa nada.
      obligacionReal({
        concepto: `${t.tipo_vinculo === 'honorarios' ? 'Honorarios' : 'Sueldo'} ${t.nombre}`,
        categoria: plan.categoria,
        monto: t.sueldo_base,
        dia: plan.dia_vencimiento,
        notas: plan.notas,
        id_trabajador: t.id_trabajador,
      });
    }
    for (const o of DATOS_LOCALES.obligaciones) {
      obligacionReal({ concepto: o.concepto, categoria: o.categoria, monto: o.monto_estimado, dia: o.dia_vencimiento, notas: o.notas });
    }
    for (const d of DATOS_LOCALES.deudas) deudas.push(deudaReal(d.tipo, d.persona, d.monto, d.descripcion, d.vence));
  }

  if (DATOS_LOCALES?.usuarios?.length) {
    // Modo real: el equipo de verdad y nada inventado. Sin movimientos reales cargados todavía,
    // los gráficos quedan vacíos: es lo que dice el libro, no un relleno que parezca real.
    const reales: Usuario[] = DATOS_LOCALES.usuarios.map((u) => ({
      id_usuario: u.id,
      email: u.email,
      nombre: u.nombre,
      foto_perfil: '',
      google_id: '',
      telegram_chat_id: '',
      rol_global: u.rol,
      moneda_principal: 'PEN',
      fecha_registro: marca,
      ultima_sesion: '',
      activo: true,
      usuario: u.usuario,
      tiene_password: true,
      debe_cambiar_password: false,
    }));
    usuarios.splice(0, usuarios.length, ...reales);

    // Cada usuario queda vinculado a su ficha de trabajador por DNI.
    for (const u of DATOS_LOCALES.usuarios) {
      const t = trabajadores.find((w) => w.documento === u.documento);
      if (t) t.id_usuario = u.id;
    }

    transacciones.splice(0, transacciones.length);
    solicitudes.splice(0, solicitudes.length);
    const soloTelcom = <T extends { id_espacio: string }>(filas: T[]) => filas.filter((f) => f.id_espacio === ESP_TELCOM);
    deudas.splice(0, deudas.length, ...soloTelcom(deudas));
    obligaciones.splice(0, obligaciones.length, ...soloTelcom(obligaciones));

    for (const c of cuentas) c.saldo_inicial = 0;
    const nuevas = DATOS_LOCALES.cuentas_telcom ?? [];
    const telcom = cuentas.filter((c) => c.id_espacio === ESP_TELCOM);
    nuevas.forEach((n, i) => {
      if (telcom[i]) Object.assign(telcom[i], { nombre: n.nombre, tipo: n.tipo, icono: n.icono, orden: i });
      else cuentas.push({ ...telcom[0], id_cuenta: `CTA_tel_real${i}`, nombre: n.nombre, tipo: n.tipo, icono: n.icono, orden: i });
    });
    // Las obligaciones reales apuntaban a la cuenta corriente: sigue existiendo con el mismo id.
  }

  const sesion: Sesion = {
    usuario: usuarios[0], // Propietario: así se ve también la pestaña Administración.
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
      db.trabajadores,
      db.prestamos,
      db.cola,
      db.conflictos,
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
        db.trabajadores.clear(),
        db.prestamos.clear(),
        // La demo no tiene backend: lo que quedó encolado de pruebas anteriores nunca se va a
        // mandar y solo ensucia el contador de pendientes.
        db.cola.clear(),
        db.conflictos.clear(),
      ]);

      await db.usuarios.bulkPut(usuarios);
      await db.espacios.bulkPut(espacios);
      await db.categorias.bulkPut(categorias);
      await db.cuentas.bulkPut(cuentas);
      await db.transacciones.bulkPut(transacciones);
      await db.deudas.bulkPut(deudas);
      await db.solicitudes.bulkPut(solicitudes);
      await db.obligaciones.bulkPut(obligaciones);
      await db.trabajadores.bulkPut(trabajadores);
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
