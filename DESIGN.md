# Chanchito — DESIGN.md

Documento normativo de diseño. **Reemplaza** las reglas visuales de `docs/CONTRACT.md § 6`
("Sistema de diseño", paleta cerrada, prohibición de sidebar). Donde este archivo y el contrato
difieran en algo visual o de navegación, gana este archivo. La arquitectura de datos, la API y la
sincronización siguen rigiéndose por el contrato.

Fecha: 2026-10-14. Estado: v1. La implementación avanza por las fases de la § 11.

**Objetivo visual:** `docs/disenio/mockup_web.png` (tablero web de Telcom) y
`docs/disenio/mockup_movil.png` (inicio móvil de Familia), generados con Codex `image_gen` a
partir de este documento. Ante una duda de composición, manda el mockup; ante un conflicto con
el texto, manda el texto. Por ejemplo: los nombres del ranking del mockup son de relleno, y los
filos de bloque son el gradiente del libro y no naranja fijo.

---

## 1. Qué es Chanchito y qué tiene que transmitir

Chanchito lleva **dos libros**: Familia (la casa) y Telcom (Ingeniería Telcom E.I.R.L., RUC
20602277900). Lo usan tres tipos de persona:

- **El propietario.** Mira el tablero completo: flujo de caja, costo de personal, SUNAT y
  vencimientos.
- **Los miembros.** Registran gastos rápido desde el celular o el bot, a veces en campo y sin
  señal.
- **El contador.** Recibe exportaciones limpias.

La idea rectora, en palabras del dueño, es que **todo se piensa como un blockchain**:

- Cada movimiento es un **bloque**: tiene autor, momento y huella digital.
- Nada se borra en silencio. Toda corrección deja rastro.
- El libro se puede auditar de punta a punta.

Lo visual tiene que contar esa historia: datos sólidos, encadenados y verificables. No es una app
de gastos "simpática".

La referencia estética es **Captain Data** (fondo negro profundo, grilla isométrica, bloques 3D,
bordes con gradiente neón, números monoespaciados). Las referencias de tablero (Power BI / Excel)
definen **qué gráficos** se usan y cómo se leen.

---

## 2. Principios

1. **Oscuro primero.** Negro profundo con superficies apenas elevadas. El color se reserva para
   datos y estados, nunca para decorar fondos.
2. **Un libro, un color.** Familia es **cian**; Telcom es **ámbar**. El color del libro activo
   tiñe el borde del hero, el selector y el gradiente de los gráficos. Tiene que ser imposible
   confundir el libro (CONTRACT § 6 sigue vigente en esto).
3. **Los números mandan.** Se escriben en monoespaciada tabular, grandes, con signo y moneda
   explícitos. El texto acompaña al número, no al revés.
4. **Bloques, no tarjetas.** Cada contenedor es un "bloque" con borde de 1px y un filo superior
   en gradiente. Se apilan como la cadena.
5. **Rastro visible.** Todo movimiento muestra su huella (`#a3f9…`), quién lo hizo y cuándo. Las
   correcciones aparecen como bloques nuevos enlazados, nunca como sobrescritura muda.
6. **Rápido en el celular, profundo en la web.** En el móvil hay 3 toques para registrar un gasto.
   En la web, un tablero denso tipo Power BI.

---

## 3. Color

### 3.1 Base (modo oscuro, por defecto)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#06070A` | Fondo de la app |
| `--bg-grid` | `rgba(255,255,255,0.035)` | Líneas de la grilla isométrica de fondo |
| `--surface-1` | `#0D0F14` | Bloques |
| `--surface-2` | `#141720` | Bloques anidados, inputs, filas en hover |
| `--surface-3` | `#1C2030` | Popovers, modales |
| `--line` | `rgba(255,255,255,0.08)` | Bordes de 1px |
| `--line-strong` | `rgba(255,255,255,0.16)` | Bordes activos, separadores de tabla |
| `--text` | `#F2F4F8` | Texto principal |
| `--text-2` | `#9AA3B5` | Texto secundario |
| `--text-3` | `#5D6577` | Etiquetas de ejes, texto deshabilitado |

### 3.2 Semántica

| Token | Valor | Uso |
|---|---|---|
| `--income` | `#3DFFA2` | Ingresos, saldo positivo |
| `--expense` | `#FF4D6D` | Gastos, saldo negativo, vencido |
| `--warning` | `#FFC53D` | Por vencer, contratos por renovar, [VERIFICAR] |
| `--info` | `#4D8DFF` | Enlaces, estados neutros, foco |

### 3.3 Identidad de cada libro

| Libro | Acento | Gradiente de filo (izq → der) |
|---|---|---|
| Familia | `--familia: #22D3EE` (cian) | `#22D3EE → #3DFFA2 → #D9F99D` |
| Telcom | `--telcom: #FFA53D` (ámbar) | `#FF5E3A → #FFA53D → #FFE14D` |
| Neutro (login, admin global) | `--neutro: #8B5CF6` | `#4D8DFF → #8B5CF6 → #EC4899` |

`--accent` se define en tiempo de ejecución según el libro activo: `[data-libro="telcom"]` en
`<html>`. Todos los componentes usan `--accent` y nunca un color de libro directamente.

### 3.4 Paleta de series para gráficos

La paleta categórica se ordena para máxima distinción en fondo oscuro. Se usa en este orden y no
se reordena por gráfico:

`#22D3EE` · `#FFA53D` · `#8B5CF6` · `#3DFFA2` · `#FF4D6D` · `#4D8DFF` · `#FFE14D` · `#EC4899` · `#2DD4BF` · `#A3A3A3`

Las secuenciales (heatmaps) van de `--surface-2` al acento del libro. La divergente
(diferencia ingreso−gasto) usa `--expense` ← `--surface-2` → `--income`.

### 3.5 Modo claro

Es secundario y opcional (`[data-tema="claro"]`). Invierte superficies (`#F5F6F8`, `#FFFFFF`),
texto `#0B0D12`, mismos acentos con un 10 % menos de luminosidad. Ningún componente puede depender
de que el modo sea oscuro.

---

## 4. Tipografía

| Rol | Familia | Peso | Uso |
|---|---|---|---|
| Display | **Space Grotesk** | 600–700 | Títulos de pantalla, cifras hero |
| UI | **Inter** | 400–600 | Texto, etiquetas, botones |
| Datos | **JetBrains Mono** | 500 | Montos, huellas, fechas en tablas, ejes |

Se cargan desde Google Fonts con `display=swap`, y `system-ui` queda como respaldo.

Escala:

| Token | Tamaño / interlineado | Fuente |
|---|---|---|
| `--fs-hero` | 44/48 | Display |
| `--fs-h1` | 30/36 | Display |
| `--fs-h2` | 22/28 | Display |
| `--fs-h3` | 17/22 | Inter 600 |
| `--fs-body` | 15/22 | |
| `--fs-small` | 13/18 | |
| `--fs-micro` | 11/14 | Mayúsculas, tracking +0.08em, para rótulos de bloque |

Reglas para montos:
- Siempre `font-variant-numeric: tabular-nums`, en Mono.
- Moneda `S/` en `--text-2`.
- Decimales a un 70 % de opacidad.
- Negativos con signo menos real (`−`) y en `--expense`.

---

## 5. Forma, espacio y profundidad

- **Grilla de 4px.** Espaciados: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64.
- **Radios:**
  - Bloques: 14px.
  - Controles: 10px.
  - Chips: pill.
  - Los gráficos dentro de un bloque no llevan radio propio.
- **Bloque** (componente base):
  - `background: var(--surface-1)`.
  - `border: 1px solid var(--line)`.
  - Filo superior de 2px con el gradiente del libro (`border-image` o pseudo-elemento).
  - Sin sombra. La profundidad viene del contraste de superficies.
- **Bloque destacado** (hero, KPI principal):
  - Borde con el gradiente del libro completo, a un 60 % de opacidad.
  - `box-shadow: 0 0 0 1px var(--accent) inset, 0 20px 60px -30px var(--accent)`, para un
    resplandor sutil.
- **Fondo:**
  - Grilla isométrica (SVG en `background-image`, líneas a 30°) en `--bg-grid`.
  - Solo detrás del contenido. En el móvil queda fija y no se desplaza.
- **Bloques 3D:**
  - Cubos isométricos (SVG propio, 3 caras con el gradiente del libro) como ilustración.
  - Aparecen en estados vacíos, en el login y en el "explorador de cadena".
  - Nunca dentro de un gráfico.

---

## 6. Movimiento

| Tipo de movimiento | Duración / curva |
|---|---|
| Transiciones de UI | 160 ms `cubic-bezier(.2,.8,.2,1)` |
| Entrada de bloques | 240 ms, desplazamiento de 8px + fade, escalonado 30 ms |
| Gráficos | 600 ms (animación de ECharts), sin rebote |

- Un movimiento nuevo **"se encadena"**: el bloque entra desde arriba y una línea conectora se
  dibuja hasta el bloque anterior en 300 ms.
- `prefers-reduced-motion`: todo se reduce a fade de 0 ms y los gráficos van sin animación.

---

## 7. Gráficos

### 7.1 Herramienta: Apache ECharts 5

Se elige **ECharts** (`echarts` + `echarts-for-react`, con importación modular para recortar el
peso) en lugar de Recharts:

- **Cubre todas las referencias en una sola librería:** barra radial concéntrica, medidor,
  barras divergentes, YTD contra meta, área de patrimonio, doble eje, dona, mapa de calor de
  calendario, cascada y treemap. Recharts no tiene medidor, calendario ni barra radial decente.
- **Renderiza en canvas**, fluido en Android de gama media dentro de la APK. Con 5 años de
  movimientos hay miles de puntos.
- **Táctil nativo:** zoom con dos dedos (`dataZoom`), tooltips al tocar y gestos.
- **Temas:** se registra un tema `chanchito-oscuro` con los tokens de la § 3. Un solo lugar define
  ejes, grillas, tooltips y la paleta.
- **Exporta a PNG** con `getDataURL()`, lo que permite compartir un gráfico por WhatsApp desde la
  APK.

**Recharts se retira** al migrar Resumen (fase 2). No conviven dos librerías de gráficos.

### 7.2 Reglas comunes

- **Ejes:**
  - Etiquetas en Mono 11px, en `--text-3`. Sin línea de eje.
  - Grilla horizontal punteada en `--line`. Sin grilla vertical.
- **Tooltip:**
  - Fondo `--surface-3`, borde `--line-strong`, montos en Mono y fecha en la cabecera.
  - En el móvil se fija abajo del gráfico (no flota sobre el dedo).
- **Leyenda** arriba a la izquierda, como chips tocables que ocultan o muestran la serie.
- **Rellenos de área:** gradiente vertical del color de la serie, del 35 % al 0 %.
- **Barras:** radio de 4px arriba y gradiente vertical del color a un 70 % de opacidad.
- **Números:** abreviados en los ejes (`12.4k`) y siempre completos en el tooltip.
- **Cada gráfico tiene título, subtítulo con el período y una conclusión de una línea**
  calculada (por ejemplo, "Personal subió 18 % vs. promedio"). Un gráfico sin conclusión no se
  publica.
- **Accesibilidad:**
  - `aria-label` con la conclusión.
  - La tabla de datos se puede ver con "Ver datos" en cada bloque.

### 7.3 Catálogo: qué gráfico va dónde

| # | Gráfico | Referencia | Dónde | Datos |
|---|---|---|---|---|
| G1 | **Fila de KPIs**: Saldo · Ingresos · Gastos · Ahorro %, cada uno con sparkline de 6 meses y delta vs. mes anterior | Personal Finance Pro, Visual Data | Tope de Inicio (web y móvil) | `useAnalisisMes`, `useTendencia` |
| G2 | **Saldo acumulado (patrimonio)** en área con gradiente | Net Worth by YearMonth | Inicio | Σ saldos de cuentas por mes |
| G3 | **Ingresos vs. gastos** (barras agrupadas) **+ flujo neto** (línea, eje derecho) | Total Income/Expenses & Cash Flow | Inicio | Tendencia de 12 meses |
| G4 | **Diferencia mensual** en barras divergentes, verde arriba y rojo abajo, con el valor en la punta | Diferencia Mensual, Análisis mensual | Inicio (web), Análisis (móvil) | ingreso − gasto por mes |
| G5 | **Gasto por categoría**: barra radial concéntrica, cada anillo una categoría con su % | Gastos (barra radial) | Familia: Inicio | `por_categoria` |
| G6 | **Gasto por grupo y categoría**: barras horizontales ordenadas, con tap para ver el detalle | Ventas por Tienda, Expenses by Category | Telcom: Inicio | `gasto_por_grupo` → categorías |
| G7 | **Medidor de presupuesto**: real vs. límite del mes, con aguja en el % y arco rojo si se excede | Ventas Totales vs Objetivos | Bloque de presupuesto | presupuestos |
| G8 | **YTD real vs. meta**: dos líneas acumuladas | Evolución de Ventas anual | Análisis (web) | Σ ingresos/gastos acumulados vs. meta anual |
| G9 | **Me deben / Debo**: dos donas con el total al centro | Assets / Liabilities | Deudas | deudas por tipo y persona |
| G10 | **Ranking de personas y trabajadores** (top 5 con medalla numerada, monto y n.º de movimientos) | Top 5 Managers | Personal / Por persona | `por_persona`, `fichas` |
| G11 | **Mapa de calor de calendario**: gasto por día del año | Bounce rate (tabla con color) | Análisis | gasto diario |
| G12 | **Cascada del mes**: saldo inicial → +ingresos → −cada grupo → saldo final | — | Análisis (Telcom) | `gasto_por_grupo` |
| G13 | **Barras de cumplimiento**: obligaciones pagadas, metas de ahorro, planilla del mes | Ingresos/Ahorro % de Cumplimiento | Inicio, Personal | `indicadores.obligaciones` |
| G14 | **Línea de tiempo de vencimientos**: los próximos 60 días (planilla, SUNAT, contratos) | — | Agenda | deudas, obligaciones, `fecha_fin` |

En el móvil, cada gráfico ocupa el ancho completo con una altura de 200–240px, y G4/G8/G11 pasan a
la pestaña Análisis. En la web, la grilla es de 12 columnas: G1 ocupa 12, G2 y G3 ocupan 6 cada
uno, y así siguiendo la composición de la referencia Personal Finance Pro.

---

### 7.4 Tablero de hojas conectadas (vista para el propietario)

Este es el pedido explícito del dueño: tablas tipo Excel fáciles de leer, **conectadas por
fórmulas**, donde ninguna tabla esté suelta. El modelo vive en `src/data/tablero.ts` y alimenta
dos cosas: la vista en la app y la descarga `.xlsx` con fórmulas reales.

**Hojas:**

| Hoja | Contenido |
|---|---|
| **Resumen** | Solo referencias a otras hojas: caja, por cobrar, por pagar, posición neta, resultado y margen del mes, costo de personal y su peso sobre los ingresos, planilla neta por pagar, gasto promedio y meses de caja. Cada fila explica cómo se calcula. |
| **Resultados** | 12 meses más el total. Ingresos por categoría, gastos por grupo (Telcom) o por categoría (Familia), resultado, margen y acumulado. |
| **Planilla** | Por trabajador: sueldo base, pagado, pendiente (`=MAX(0;sueldo−pagado)`), adelantos y neto a pagar. Incluye "personal sin trabajador" y control contra Resultados. |
| **Caja** | Por cuenta: saldo al inicio del mes, ingresos, gastos y saldo final (`=B+C−D`). Control contra Resultados. |
| **Por cobrar y pagar** | Deudas abiertas con días al vencimiento (`=D−HOY()`) y totales con `SUMAR.SI`. |

**Reglas:**
- **Filas de control.** "Diferencia (debe ser 0)" se muestra con ✓ o ⚠. Es la forma de ver que
  los números cuadran entre hojas.
- **Tocar una celda** muestra su fórmula en la barra `fx`, en español. Las referencias a otras
  hojas son chips que llevan a la celda de origen.
- **Pruebas.** Un evaluador de fórmulas recalcula cada celda y la compara con el valor mostrado
  (`tablero.test.ts`). Si alguien cambia una fórmula sin cambiar el valor, el test falla.

### 7.5 Auditoría

Es una pantalla para el propietario (pestaña "Auditoría", con un contador de hallazgos de
severidad alta). Lista lo que hay que revisar, priorizado, cada cosa con un botón "Ir a
corregir". Las reglas viven en `src/data/auditoria.ts` y tienen tests. Revisa:
- Controles entre hojas que no dan 0.
- Pagos vencidos y lo que vence en 7 días.
- Contratos por vencer (45 días) o vencidos.
- Trabajadores en planilla sin ONP/AFP, sin sueldo base o sin DNI.
- Datos marcados [VERIFICAR].
- Pagos de personal sin trabajador.
- Posibles duplicados: mismo día, monto, categoría y cuenta.
- Gastos atípicos: más de 4 veces la mediana de su categoría.
- Obligaciones del mes sin generar.
- Conflictos y cambios sin subir a Sheets.

### 7.6 Préstamos bancarios

Se ven en Deudas, como tarjetas por préstamo. Cada tarjeta muestra:
- El saldo de capital.
- El total por pagar con intereses.
- La próxima cuota.
- Las cuotas vencidas.
- El cronograma desplegable, con "Pagar" en cada cuota.

El alta es en dos pasos: primero los datos y después el cronograma, que se puede editar celda
por celda para copiar el del banco. El modelo está en CONTRACT § 4-quinquies.

## 8. Navegación y layout

### 8.1 Móvil (PWA y APK), < 768px

Toma lo que funciona de la APK actual y lo sube de nivel.

- **Barra superior:**
  - Logo del chanchito en monocromo con el acento del libro.
  - Selector de libro: control segmentado **Familia | Telcom**, siempre visible.
  - Búsqueda, campana (vencimientos) y avatar.
- **Selector de período:** **Día · Semana · Mes · Año · Rango**, en pastillas bajo la barra
  superior. Viene de la APK actual; reemplaza las flechas de mes.
- **Barra de pestañas inferior** (5): **Inicio · Movimientos · Análisis · Deudas · Más**.
  - En Más quedan Personal, Cuentas, Cadena (auditoría), Administración y Ajustes.
- **Doble botón flotante** (de la APK actual): **− Gasto** (`--expense`) y **+ Ingreso**
  (`--income`).
  - Flotan sobre la barra de pestañas, se ocultan al desplazar hacia abajo y reaparecen al subir.
  - Al mantener pulsado **− Gasto** se abre la cámara para leer un voucher (Gemini, como en el
    bot).
- **Hoja de registro** (bottom sheet, no pantalla completa), en este orden:
  1. Monto, grande y con teclado numérico.
  2. Categoría, con una grilla de íconos recientes primero.
  3. Cuenta, preseleccionando la de menor `orden`.
  4. De quién.
  5. Trabajador, solo en el grupo de personal.
  6. Nota y foto.

  Se guarda en 3 toques en el caso típico.

### 8.1-bis Referencia de UX: Monefy (`/Aplicaciones fotos`, 19 capturas)

El boceto de la APK es Monefy. Esto se adopta, en versión oscura y con dos libros:

- **La rueda de categorías es el inicio móvil.**
  - Dona de gasto del período en el centro, con el saldo grande y los totales de ingreso y gasto.
  - Alrededor, 8–12 íconos de las categorías más usadas, cada uno con su % debajo.
  - **Un toque en un ícono abre la hoja de registro con esa categoría ya elegida.** Es el camino
    más corto a "gasto guardado": un toque, el monto y guardar.
  - Tocar una porción de la dona o el saldo abre los movimientos filtrados.
  - En Telcom, la rueda muestra **grupos** (operativos, personal, activos, impuestos) y al tocar
    uno se despliegan sus categorías. Con 20 o más categorías, una rueda plana no se lee.
- **Teclado calculadora** en la hoja de registro (`+ − × ÷ =`), porque "3 pasajes de 12.50" se
  anota tal cual. El resultado se valida igual que hoy (`validarMonto`).
- **Panel de período y cuenta:** Día · Semana · Mes · Año · Todo · Intervalo · Elegir fecha, más
  el selector de cuenta (la APK actual ya muestra los cuatro primeros).
- **Movimientos agrupados por categoría**, con contador y total, que se expanden a sus registros
  (vista alternativa a la lista cronológica).
- **Transferir entre cuentas** como acción de primer nivel (⇆ en la barra superior).
- **Ajustes:**
  - Modo presupuesto.
  - Trasladar saldo al mes siguiente.
  - Mostrar recurrentes futuros.
  - Primer día del mes (útil si la planilla corta otro día).
  - Bloqueo con PIN o biometría.
  - Exportar.
  - Copia de seguridad: aquí la "sincronización" ya es Sheets, así que el respaldo es exportar
    la cadena.
- **Recordatorios:** se piden una vez en el primer arranque, con una explicación de para qué.
  Son notificaciones locales de Capacitor para vencimientos de planilla, SUNAT y contratos.

Lo que **no** se copia:
- El paywall.
- El onboarding de 4 pantallas de pura presentación. Aquí basta con una pantalla: elegir el
  libro y activar los recordatorios.
- La falta de pestañas. Monefy cabe en una pantalla porque es personal; Chanchito lleva
  empresa, planilla y deudas, y necesita la navegación de la § 8.1.

### 8.2 Web (dashboard), ≥ 1024px

- **Barra lateral izquierda fija** de 240px, colapsable a 72px:
  - Arriba, el logo y el selector de libro.
  - Navegación: Inicio, Movimientos, Análisis, Personal, Deudas y obligaciones, Cuentas, Cadena,
    Administración.
  - Abajo, el estado de sincronización y el usuario.
- **Encabezado de página:**
  - Título en Display.
  - Selector de período con pastillas de años al estilo de la referencia Personal Finance Pro.
  - Acciones a la derecha: Exportar, Nuevo movimiento.
- **Contenido** en una grilla de 12 columnas con un hueco de 16px y un ancho máximo de 1440px.

### 8.3 Tablet (768–1023px)

Es el layout móvil con dos columnas de bloques. La barra lateral aparece como riel de íconos de
72px y la barra de pestañas inferior se oculta.

---

## 9. "Cadena": el libro como blockchain

### 9.1 Modelo (propuesta de backend, fase 4)

- **Hash por bloque.** Cada fila de `Transacciones` (y de `PagosDeuda`) guarda:
  - `hash = SHA-256(hash_anterior + forma_canónica(fila))`.
  - La cadena es por libro (`id_espacio`). Se calcula en Apps Script con
    `Utilities.computeDigest`, **dentro del mismo lock** que la escritura, así que el orden de la
    cadena es el orden en que el servidor aceptó los bloques.
- **Bloque génesis.** Hay uno por libro, con hash fijo.
- **Las correcciones son bloques nuevos:**
  - Editar un movimiento ya no sobrescribe la fila. Crea un bloque `rectificación` que apunta al
    original (`ref`) y contiene los campos nuevos.
  - Eliminar crea un bloque `anulación`.
  - La vista "estado actual" se calcula sobre la cadena: último bloque de cada `ref` que no esté
    anulado.
  - Esto es compatible con el sync actual: la rectificación viaja como un "crear" más.
- **Verificación.** Una acción `verificarCadena(id_espacio)` recorre la cadena y reporta el primer
  bloque cuyo hash no coincide. Detecta ediciones a mano en la hoja de Sheets.
- **Sello diario.** Opcional y para más adelante: un trigger diario guarda el hash de cabeza de
  cada libro en una hoja `Sellos` y lo envía al Telegram del propietario. Es un testigo externo
  barato.

Esto **no** es una blockchain pública ni usa cripto. Es un libro encadenado con hash, que da lo
que se busca: inmutabilidad práctica, auditoría y rastro de cada corrección.

### 9.2 Cómo se ve

- Cada fila de movimientos muestra un **chip de huella** (`◆ a3f9c2`, Mono 11px, en `--text-3`).
  Al tocarlo se abre el bloque: autor, hora, origen (app, bot, foto), hash anterior, hash propio,
  rectificaciones y foto del voucher.
- Las correcciones se ven como **bloques enlazados**: una línea vertical une el original tachado
  con la rectificación.
- La pantalla **Cadena** (web y móvil):
  - Línea de tiempo vertical de bloques (cubos isométricos pequeños como nodos).
  - Filtros por autor y tipo.
  - Botón **Verificar integridad**, que dibuja la cadena en verde si cuadra o marca en rojo el
    primer eslabón roto.

---

## 10. Componentes

| Componente | Notas |
|---|---|
| `Bloque` | Contenedor base (§ 5). Props: `titulo`, `subtitulo`, `conclusion`, `acciones`, `destacado`, `verDatos` |
| `KpiTile` | Rótulo micro, monto en Display, delta (▲▼ con color) y sparkline (ECharts mini) |
| `Grafico` | Envoltorio de ECharts: tema, tamaño responsive, estado vacío, esqueleto, "Ver datos", "Compartir PNG" |
| `SelectorLibro` | Control segmentado con el acento del libro; cambia `data-libro` |
| `SelectorPeriodo` | Pastillas Día/Semana/Mes/Año/Rango y años |
| `FilaMovimiento` | Ícono de categoría, descripción, autor y trabajador, monto Mono y chip de huella |
| `HojaRegistro` | Bottom sheet de registro (§ 8.1) |
| `BotonesFlotantes` | − Gasto / + Ingreso |
| `ChipEstado` | pendiente · sincronizado · conflicto · por vencer · vencido · [VERIFICAR] |
| `Medalla` | Número de ranking (G10) |
| `CuboIso` | SVG de bloque isométrico con el gradiente del libro |
| `FichaTrabajador` | Lo de `ResumenAnalisis` actual, rediseñado como bloque expandible con mini-barras por categoría |

---

## 11. Plataforma: una sola base de código

- **Web y PWA:** Vite + React + TypeScript (lo actual). Se despliega en GitHub Pages.
- **APK Android:** **Capacitor 6** envuelve el mismo build. No se reescribe en Flutter ni en
  React Native, que obligarían a mantener dos apps.
  - Plugins: `@capacitor/camera` (voucher), `@capacitor/local-notifications` (vencimientos sin
    servidor), `@capacitor/share` (PNG o CSV por WhatsApp), `@capacitor/haptics` y bloqueo
    biométrico (`@capgo/capacitor-native-biometric`).
  - Dexie sigue siendo el almacenamiento offline: IndexedDB funciona igual en el WebView.
  - Requisito para compilar: Android Studio con SDK 34 y JDK 17 en la máquina.
- **El backend no cambia:** Apps Script + Sheets.

### Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Análisis por persona y trabajador, indicadores, variaciones, saldos, CSV y trabajadores | Hecho (2026-10-14) |
| 1 | Tokens de la § 3–5, fuentes, `Bloque`, tema oscuro, `SelectorLibro` con `data-libro` | En curso |
| 2 | ECharts + tema + `Grafico`; migrar Resumen a G1–G6 y G13; retirar Recharts | En curso |
| 3 | Navegación nueva (§ 8): 5 pestañas, rueda de categorías como inicio móvil (§ 8.1-bis), doble botón flotante, hoja de registro con teclado calculadora, panel de período, transferir, layout web con barra lateral | Pendiente |
| 4 | Cadena (§ 9): hash en el backend, rectificaciones, pantalla Cadena, verificación | Pendiente, requiere decisión del dueño |
| 5 | Capacitor: proyecto Android, plugins, ícono y splash, APK firmada | Pendiente |
| 6 | Análisis profundo: G7, G8, G11, G12 y G14 | Pendiente |

---

## 12. Lo que no se hace

- Fondos con gradiente a pantalla completa ni glassmorphism por todos lados. El neón vive en los
  filos y en los datos.
- Gráficos de torta con más de 5 porciones. Por encima de 5 se usan barras.
- Gráficos 3D. Los cubos son ilustración, nunca datos.
- Colores fuera de la § 3 en la interfaz. Los colores de categoría salen de los datos y se
  mapean a la paleta de series (§ 3.4).
- Librerías de componentes (MUI, Bootstrap, shadcn). Esta regla del contrato se mantiene: los
  componentes son propios.
