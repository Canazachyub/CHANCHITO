import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/browser';
import App from './App';
import './design/tokens.css';
import { iniciarTema } from './design/tema';

iniciarTema();

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0 });
}

async function arrancar() {
  // Modo demo local: data de ejemplo + sesión falsa para ver la app sin backend.
  // Doble candado (flag explícito + !PROD) para que no llegue nunca a una build publicada.
  if (import.meta.env.VITE_DEMO === 'true' && !import.meta.env.PROD) {
    const { sembrarDemo } = await import('./offline/demo');
    await sembrarDemo();
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void arrancar();
