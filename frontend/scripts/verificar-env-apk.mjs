// Corta `npm run apk` si el build no sabe a qué servidor hablar: una APK sin VITE_API_URL
// instala bien pero en el login dice "sin conexión" aunque el celular tenga internet.
import { loadEnv } from 'vite';

const env = loadEnv('apk', process.cwd(), 'VITE_');
const faltan = ['VITE_API_URL', 'VITE_SHARED_TOKEN'].filter((k) => !env[k]);
if (faltan.length) {
  console.error(`\nNo se compila la APK: falta ${faltan.join(' y ')}.`);
  console.error('Crea frontend/.env.apk.local (fuera de git) con la URL /exec del Web App y el token.');
  console.error('Ver docs/DESPLIEGUE.md § 9.\n');
  process.exit(1);
}
if (env.VITE_DEMO === 'true') {
  console.error('\nNo se compila la APK con VITE_DEMO=true.\n');
  process.exit(1);
}
console.log('Configuración de la APK: OK →', new URL(env.VITE_API_URL).host);
