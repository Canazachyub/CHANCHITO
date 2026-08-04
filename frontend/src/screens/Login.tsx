import { useEffect, useRef, useState } from 'react';
import type { Sesion } from '../data/types';
import { iniciarSesion } from '../data/api';
import './Login.css';

interface LoginProps {
  onEntrar: (s: Sesion) => void;
}

// Tipado mínimo de Google Identity Services — la librería no publica tipos
// propios y no se instala @types/google.accounts para no traer una
// dependencia extra solo por esto.
interface CredencialGoogle {
  credential: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (respuesta: CredencialGoogle) => void;
  }): void;
  renderButton(
    contenedor: HTMLElement,
    opciones: { theme: string; size: string; shape: string; width: number; text: string; locale: string }
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const SRC_GIS = 'https://accounts.google.com/gsi/client';

type EstadoLogin = 'inactivo' | 'cargando_script' | 'listo' | 'autenticando' | 'no_autorizado' | 'error';

function cargarScriptGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existente = document.querySelector<HTMLScriptElement>(`script[src="${SRC_GIS}"]`);
    if (existente) {
      existente.addEventListener('load', () => resolve());
      existente.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity Services')));
      return;
    }
    const script = document.createElement('script');
    script.src = SRC_GIS;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
    document.head.appendChild(script);
  });
}

/**
 * Reconoce el código de error normativo 'USUARIO_NO_AUTORIZADO' (CONTRACT § 3) sin acoplarse
 * al tipo de error concreto que lance la capa de datos: duck-typing sobre `.codigo` (así lo
 * expone ErrorApi de data/cliente.ts, que no forma parte de la interfaz pública de data/api.ts
 * y por eso no se importa acá) con fallback al mensaje por si acaso.
 */
function esUsuarioNoAutorizado(err: unknown): boolean {
  if (err && typeof err === 'object' && 'codigo' in err) {
    return (err as { codigo?: unknown }).codigo === 'USUARIO_NO_AUTORIZADO';
  }
  const mensaje = err instanceof Error ? err.message : String(err);
  return mensaje.includes('USUARIO_NO_AUTORIZADO');
}

export default function Login({ onEntrar }: LoginProps) {
  const [estado, setEstado] = useState<EstadoLogin>('cargando_script');
  const contenedorBoton = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) {
      setEstado('error');
      return;
    }

    let cancelado = false;

    async function manejarCredencial(respuesta: CredencialGoogle) {
      setEstado('autenticando');
      try {
        const sesion = await iniciarSesion(respuesta.credential);
        if (!cancelado) onEntrar(sesion);
      } catch (err) {
        if (cancelado) return;
        setEstado(esUsuarioNoAutorizado(err) ? 'no_autorizado' : 'error');
      }
    }

    cargarScriptGis()
      .then(() => {
        if (cancelado || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: manejarCredencial });
        if (contenedorBoton.current) {
          window.google.accounts.id.renderButton(contenedorBoton.current, {
            theme: 'filled_blue',
            size: 'large',
            shape: 'pill',
            width: 280,
            text: 'continue_with',
            locale: 'es',
          });
        }
        setEstado('listo');
      })
      .catch(() => {
        if (!cancelado) setEstado('error');
      });

    return () => {
      cancelado = true;
    };
  }, [clientId, onEntrar]);

  return (
    <div className="login">
      <div className="login__contenido">
        <div className="login__logo" aria-hidden="true">🐷</div>
        <h1 className="u-large-title login__titulo">Chanchito</h1>
        <p className="u-body login__subtitulo">Tu billetera compartida, siempre a mano.</p>

        <div className="login__accion">
          {estado === 'no_autorizado' && (
            <p className="u-callout login__mensaje login__mensaje--error" role="alert">
              Tu cuenta no está dada de alta. Pídele acceso al administrador.
            </p>
          )}
          {estado === 'error' && (
            <p className="u-callout login__mensaje login__mensaje--error" role="alert">
              No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.
            </p>
          )}
          {estado === 'autenticando' && (
            <p className="u-callout login__mensaje" role="status">Entrando…</p>
          )}

          <div className="login__boton-envoltorio">
            {/* Google renderiza su propio botón acá adentro; se mantiene montado
                siempre para no perder la referencia del contenedor. */}
            <div ref={contenedorBoton} className="login__boton-google" />
            {estado === 'cargando_script' && (
              <div className="u-skeleton login__boton-esqueleto" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
