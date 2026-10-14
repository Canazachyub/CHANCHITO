/**
 * Tema claro/oscuro (DESIGN.md § 3.5). La preferencia ('sistema' | 'claro' | 'oscuro') es una
 * comodidad por dispositivo: vive en localStorage ('chanchito.tema'), nunca en el backend.
 * 'sistema' sigue el ajuste del teléfono/PC (prefers-color-scheme) y reacciona si cambia.
 * El atributo html[data-tema] lo lee tokens.css; el script de index.html lo fija antes del
 * primer pintado para que no haya destello.
 */
import { useSyncExternalStore } from 'react';

export type PreferenciaTema = 'sistema' | 'claro' | 'oscuro';
export type TemaResuelto = 'claro' | 'oscuro';

export const CLAVE_TEMA = 'chanchito.tema';
const CONSULTA_CLARO = '(prefers-color-scheme: light)';

function valida(v: unknown): v is PreferenciaTema {
  return v === 'sistema' || v === 'claro' || v === 'oscuro';
}

export function leerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    if (valida(v)) return v;
  } catch {
    /* almacenamiento bloqueado: se usa el valor por defecto */
  }
  return 'sistema';
}

export function guardarPreferencia(p: PreferenciaTema): void {
  try {
    localStorage.setItem(CLAVE_TEMA, p);
  } catch {
    /* modo privado o sin almacenamiento: el cambio rige solo en esta sesión */
  }
}

function resolver(p: PreferenciaTema): TemaResuelto {
  if (p !== 'sistema') return p;
  try {
    return window.matchMedia(CONSULTA_CLARO).matches ? 'claro' : 'oscuro';
  } catch {
    return 'oscuro';
  }
}

/** Fija html[data-tema] y la barra de estado del navegador; devuelve el tema resuelto. */
export function aplicarTema(p: PreferenciaTema): TemaResuelto {
  const resuelto = resolver(p);
  const raiz = document.documentElement;
  raiz.dataset.tema = resuelto;
  const bg = getComputedStyle(raiz).getPropertyValue('--bg').trim();
  if (bg) {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = bg;
  }
  return resuelto;
}

// ---------------------------------------------------------------------------------------------
// Almacén mínimo para el hook (y para que haya un único listener del sistema).

let preferencia: PreferenciaTema = 'sistema';
let resuelto: TemaResuelto = 'oscuro';
let iniciado = false;
const oyentes = new Set<() => void>();

function notificar() {
  oyentes.forEach((f) => f());
}

function reaplicar() {
  const nuevo = aplicarTema(preferencia);
  if (nuevo !== resuelto) {
    resuelto = nuevo;
    notificar();
  }
}

/** Aplica la preferencia guardada y escucha al sistema. Idempotente; se llama desde main.tsx. */
export function iniciarTema(): void {
  if (iniciado) return;
  iniciado = true;
  preferencia = leerPreferencia();
  resuelto = aplicarTema(preferencia);
  try {
    const mql = window.matchMedia(CONSULTA_CLARO);
    // Solo actúa mientras la preferencia sea 'sistema'.
    const alCambiar = () => {
      if (preferencia === 'sistema') reaplicar();
    };
    if (mql.addEventListener) mql.addEventListener('change', alCambiar);
    else mql.addListener(alCambiar);
  } catch {
    /* sin matchMedia: queda el tema oscuro */
  }
  // Otra pestaña cambió la preferencia.
  window.addEventListener('storage', (e) => {
    if (e.key !== CLAVE_TEMA) return;
    preferencia = leerPreferencia();
    reaplicar();
    notificar();
  });
}

function suscribir(cb: () => void): () => void {
  iniciarTema();
  oyentes.add(cb);
  return () => oyentes.delete(cb);
}

// Firma "preferencia|resuelto": un string es estable para useSyncExternalStore.
const instantanea = () => `${preferencia}|${resuelto}`;

export function useTema(): {
  preferencia: PreferenciaTema;
  resuelto: TemaResuelto;
  cambiar: (p: PreferenciaTema) => void;
} {
  const firma = useSyncExternalStore(suscribir, instantanea, () => 'sistema|oscuro');
  const [pref, res] = firma.split('|') as [PreferenciaTema, TemaResuelto];
  return { preferencia: pref, resuelto: res, cambiar: cambiarTema };
}

function cambiarTema(p: PreferenciaTema): void {
  iniciarTema();
  preferencia = p;
  guardarPreferencia(p);
  resuelto = aplicarTema(p);
  notificar();
}
