import { useEffect, useRef, useState, type FormEvent } from 'react';
import loginHero from '../assets/login.webp';
import type { Sesion } from '../data/types';
import { iniciarSesion, iniciarSesionConPassword } from '../data/api';
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

/** Código normativo del backend (CONTRACT § 3) por duck-typing, igual que arriba. */
function codigoDe(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'codigo' in err) return String((err as { codigo?: unknown }).codigo);
  return undefined;
}

function mensajeLoginPassword(err: unknown): string {
  const codigo = codigoDe(err);
  if (codigo === 'SIN_CONFIGURAR') return 'Esta versión de la app no tiene configurado el servidor. Avísale al administrador.';
  if (codigo === 'CREDENCIALES_INVALIDAS') return 'Usuario o contraseña incorrectos';
  if (codigo === 'CUENTA_BLOQUEADA') {
    return (err as { detalle?: string }).detalle || 'Cuenta bloqueada temporalmente. Intenta más tarde.';
  }
  // Sin código del servidor: fetch falló (TypeError) o no hay red.
  if (!codigo || err instanceof TypeError || !navigator.onLine) {
    return 'Sin conexión: para entrar la primera vez necesitas internet';
  }
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

const OJO_ABIERTO = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const OJO_CERRADO = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Login({ onEntrar }: LoginProps) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const [estado, setEstado] = useState<EstadoLogin>(clientId ? 'cargando_script' : 'inactivo');
  const contenedorBoton = useRef<HTMLDivElement>(null);

  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [errorPassword, setErrorPassword] = useState<string | undefined>();

  async function entrarConPassword(e: FormEvent) {
    e.preventDefault();
    if (entrando) return;
    if (!usuario.trim() || !password) {
      setErrorPassword('Escribe tu usuario y tu contraseña');
      return;
    }
    setEntrando(true);
    setErrorPassword(undefined);
    try {
      const sesion = await iniciarSesionConPassword(usuario, password);
      onEntrar(sesion);
    } catch (err) {
      setErrorPassword(mensajeLoginPassword(err));
      setEntrando(false);
    }
  }

  useEffect(() => {
    if (!clientId) return;
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
        <img className="login__hero" src={loginHero} alt="" aria-hidden="true" width={220} height={290} />
        <h1 className="u-large-title login__titulo">Chanchito</h1>
        <p className="u-body login__subtitulo">Tu billetera compartida, siempre a mano.</p>

        <form className="login__form" onSubmit={entrarConPassword} noValidate>
          <label className="login__campo">
            <span className="u-subhead">Usuario</span>
            <input
              className="login__input"
              type="text"
              name="usuario"
              value={usuario}
              onChange={(e) => { setUsuario(e.target.value); setErrorPassword(undefined); }}
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              placeholder="ej. darwin"
              disabled={entrando}
            />
          </label>
          <label className="login__campo">
            <span className="u-subhead">Contraseña</span>
            <span className="login__password">
              <input
                className="login__input"
                type={verPassword ? 'text' : 'password'}
                name="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrorPassword(undefined); }}
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Tu contraseña"
                disabled={entrando}
              />
              <button
                type="button"
                className="login__ojo"
                onClick={() => setVerPassword((v) => !v)}
                aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verPassword}
              >
                {verPassword ? OJO_CERRADO : OJO_ABIERTO}
              </button>
            </span>
          </label>

          {errorPassword && (
            <p className="u-callout login__mensaje login__mensaje--error" role="alert">{errorPassword}</p>
          )}

          <button type="submit" className="login__entrar" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {clientId && (
          <div className="login__accion">
            <p className="u-footnote login__separador"><span>o entra con Google</span></p>

            {estado === 'no_autorizado' && (
              <p className="u-callout login__mensaje login__mensaje--error" role="alert">
                Tu cuenta no está dada de alta. Pídele acceso al administrador.
              </p>
            )}
            {estado === 'error' && (
              <p className="u-callout login__mensaje login__mensaje--error" role="alert">
                No se pudo iniciar sesión con Google. Revisa tu conexión e intenta de nuevo.
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
        )}
      </div>
    </div>
  );
}
