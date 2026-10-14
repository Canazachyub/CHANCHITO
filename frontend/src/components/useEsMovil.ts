import { useSyncExternalStore } from 'react';

/** Debe coincidir con el corte de Shell.css / TabBar.css (< 768px = móvil). */
const CONSULTA = '(max-width: 767.98px)';

function suscribir(cb: () => void): () => void {
  const mql = window.matchMedia(CONSULTA);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function leer(): boolean {
  return window.matchMedia(CONSULTA).matches;
}

/** true en pantallas < 768px (APK y navegador del teléfono). Reacciona a rotar o redimensionar. */
export function useEsMovil(): boolean {
  return useSyncExternalStore(suscribir, leer, () => false);
}
