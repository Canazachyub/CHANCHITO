import type { CapacitorConfig } from '@capacitor/cli';

// DESIGN.md § 11: Capacitor envuelve el mismo build de Vite (`vite build --mode apk`).
const config: CapacitorConfig = {
  appId: 'pe.telcom.chanchito',
  appName: 'Chanchito',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#06070A' },
};

export default config;
