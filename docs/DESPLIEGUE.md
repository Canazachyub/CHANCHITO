# Despliegue: pasar de las pruebas al uso real

Guía para el propietario. Hay que hacerla **en orden** y con la cuenta dueña del proyecto de
Apps Script.

- **Hoja:** APPTELCOMAHORRO (`13Sm2zB6O239bBHGqNJWSRrWMuRskqYmXmZsjbz9-4KA`).
- **Proyecto de Apps Script:** `1FPwSLcZcLjlNnS70nXiOcPreRR3Bqa2u_xnZxpHhgWZa2O5m--ISRZyx`.

> **Antes de empezar:** en la hoja, *Archivo → Crear una copia*. Es el respaldo; si algo sale
> raro, se vuelve a esa copia.

## 1. Generar el código nuevo

```bash
npm test          # tiene que decir "Tests: ... passed"
npm run bundle    # genera build/Code.gs
```

## 2. Reemplazar el código en Apps Script

1. Abre el editor del proyecto y entra a `Código.gs`.
2. Selecciona todo y bórralo.
3. Pega el contenido completo de `build/Code.gs`.
4. Guarda con 💾.

## 3. Crear las hojas y columnas nuevas

1. En el desplegable de funciones elige `inicializarSistema` y pulsa **Ejecutar**.
2. Agrega, sin tocar tus datos:
   - Las hojas `Trabajadores` y `Prestamos`.
   - Las columnas nuevas al final: `id_trabajador` y las de cuotas en Deudas, y `usuario` y las
     de contraseña en Usuarios.
   - Las categorías financieras.
3. En el **Registro de ejecución** revisa que diga `success: true`.

## 4. Limpiar los datos de prueba

1. Ejecuta `limpiezaPrueba`. **No escribe nada.** En el registro muestra cuántas filas apagaría
   de cada hoja. Lo esperado: 13 transacciones, 2 deudas, 2 presupuestos, los espacios
   personales viejos con sus cuentas y categorías, `testclaude@test.com` y la membresía
   huérfana `USR_6cc2625f`.
2. Si cuadra, ejecuta `limpiezaAplicar`.

Nada se borra: las filas quedan con `eliminado = TRUE` o `activo = FALSE`.

## 5. Publicar la versión nueva (sin cambiar la URL)

1. Ve a *Implementar → Administrar implementaciones → ✏️ (editar) → Versión: Nueva versión →
   Implementar*.
2. **No** uses "Nueva implementación": cambiaría la URL y habría que reconfigurar la app y el
   bot.

## 6. Crear las cuentas del equipo

Se crean de una vez, con una contraseña inicial común **que no se guarda en ningún lado**:

1. En el editor de Apps Script ve a *⚙️ Configuración del proyecto → Propiedades del script →
   Agregar propiedad*. Nombre: `PASSWORD_INICIAL`. Valor: la contraseña inicial que acordaron.
2. En el desplegable de funciones elige `crearCuentasEquipo` y pulsa **Ejecutar**. Hace esto:
   - **Crea o actualiza** `jael` y `yubert` (los dos propietarios), y `darwin` y `willy`
     (miembros).
   - A Jael y Yubert les **reutiliza la fila que ya tenían**, así conservan su login con Google.
   - Todas quedan con **cambio de contraseña obligatorio** al primer ingreso.
   - **Borra `PASSWORD_INICIAL`** al terminar.
3. Revisa el *Registro de ejecución*: tiene que listar las 4 cuentas y decir que borró la
   propiedad.
4. Cada persona entra con su usuario y la contraseña inicial, y la app le pide una nueva y
   personal.
5. Si alguien la olvida: *Administración → Restablecer contraseña* genera una temporal nueva.
6. Si alguien está en planilla, vincúlalo a su ficha en *Administración → Trabajadores*. Así sus
   gastos y solicitudes caen en su ficha.

> Una contraseña inicial común solo es aceptable porque **se cambia al primer ingreso**. Si
> alguien siguiera con la común, cualquiera del equipo podría registrar a su nombre y la
> auditoría perdería sentido.

## 7. Usuarios viejos

Tú decides qué hacer con las cuentas de Google que ya existían (`yubertc1@`, `canazach12@`,
`zaelatmosfera@`):
- **Darlas de baja** desde Administración, si cada persona va a usar su usuario nuevo.
- **Asignarles un usuario** para que puedan entrar de las dos formas.

## 8. Instalar la app en los celulares

Mientras se prepara la APK (fase 5 de `DESIGN.md`):
1. Abre la app en Chrome del celular.
2. Ve a *⋮ → Agregar a pantalla principal*.

Queda como app y funciona sin señal: lo que se registra offline se sube solo al volver la
conexión.

## 9. APK Android

La APK envuelve el mismo build de la app con Capacitor 6 (`DESIGN.md` § 11). No hay segunda
base de código.

**Requisitos en la PC:** Node, JDK 17 o 21 (`JAVA_HOME`) y Android SDK (`ANDROID_HOME`);
Android Studio los trae.

**Antes de compilar:** la APK se compila en modo `apk`, así que lee
**`frontend/.env.apk.local`**. Ese archivo está fuera de git, y **no** se usa
`.env.production.local`. Créalo con:

```
VITE_API_URL=<URL /exec del Web App de Apps Script>
VITE_SHARED_TOKEN=<token compartido, el mismo SHARED_TOKEN de las propiedades del script>
VITE_GOOGLE_CLIENT_ID=<client id de Google, opcional>
VITE_DEMO=false
```

Si falta la URL o el token, o si queda `VITE_DEMO=true`, `npm run apk` **se niega a compilar**
(`scripts/verificar-env-apk.mjs`). Una APK sin servidor se instala bien, pero en el login dice
"no tiene configurado el servidor".

**Compilar:**

```
cd frontend
npm run apk
```

Hace `tsc -b`, `vite build --mode apk` (base `./`, sin service worker), `cap sync` y
`gradlew assembleDebug`. La primera vez Gradle descarga dependencias (unos minutos).

**Resultado:** `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

**Instalar:**
- Por USB: activa *Depuración USB* en el celular y ejecuta `adb install -r app-debug.apk`; o copia
  el archivo al celular y ábrelo.
- Por WhatsApp (o Drive): envíate la APK, descárgala y ábrela; Android pedirá permitir
  *instalar apps desconocidas* para esa aplicación.

**Cada versión nueva exige recompilar** y reinstalar la APK: dentro de la app no hay service
worker, así que no se actualiza sola. La versión web de GitHub Pages sí se actualiza sola.
Esta es una APK de depuración; la firmada para distribuir llega con la fase 5.
