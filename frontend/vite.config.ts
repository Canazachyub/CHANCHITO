import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// CONTRACT § 6: despliegue en GitHub Pages bajo subruta → base '/CHANCHITO/'.
export default defineConfig({
  base: '/CHANCHITO/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // El manifest ya vive en public/manifest.webmanifest y index.html lo enlaza a mano
      // (index.html es de solo lectura para este agente): no generar uno duplicado.
      manifest: false,
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: {
        // Solo el shell (JS/CSS/HTML/iconos) se precachea para que la app abra sin conexión.
        // Las llamadas a la API de Apps Script NUNCA pasan por acá: la data offline vive en
        // Dexie (offline/db.ts), no en el cache del service worker. Si Workbox cacheara
        // también las respuestas de red, la app podría mostrar datos viejos "fantasma" que
        // ni siquiera Dexie tiene, salteándose por completo el control de revisiones.
        globPatterns: ['**/*.{js,css,html,webmanifest,png,svg,ico}'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
  ],
});
