import { useState, type FormEvent } from 'react';
import type { Sesion } from '../data/types';
import { cambiarPassword, cerrarSesion } from '../data/api';
import '../components/Formulario.css';
import './CambiarPassword.css';

interface CambiarPasswordProps {
  sesion: Sesion;
  /** true = pantalla bloqueante tras entrar con contraseña temporal; false = desde "Cambiar contraseña". */
  obligatorio: boolean;
  /** Solo en modo voluntario: cierra la pantalla sin cambiar nada. */
  onCerrar?: () => void;
}

function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Mismas reglas que backend/lib_password.js (el servidor es la autoridad; esto es solo guía en vivo). */
function evaluar(nueva: string, usuario: string, nombre: string) {
  const n = normalizar(nueva);
  const partes = [usuario, ...nombre.split(/\s+/)].map(normalizar).filter((p) => p.length >= 4);
  return {
    largo: nueva.length >= 8,
    mezcla: /[a-z]/i.test(nueva) && /\d/.test(nueva),
    sinDatos: nueva.length > 0 && !partes.some((p) => n.includes(p)),
  };
}

function mensajeError(err: unknown): string {
  const codigo = err && typeof err === 'object' && 'codigo' in err ? String((err as { codigo?: unknown }).codigo) : undefined;
  const detalle = err && typeof err === 'object' && 'detalle' in err ? (err as { detalle?: string }).detalle : undefined;
  if (codigo === 'PASSWORD_DEBIL') return detalle || 'La contraseña es muy débil. Elige otra.';
  if (codigo === 'CREDENCIALES_INVALIDAS') return 'La contraseña actual no es correcta';
  if (!codigo || err instanceof TypeError || !navigator.onLine) return 'Sin conexión: para cambiar la contraseña necesitas internet';
  return detalle || 'No se pudo cambiar la contraseña. Intenta de nuevo.';
}

function Requisito({ cumple, texto }: { cumple: boolean; texto: string }) {
  return (
    <li className={`cambiar-pw__req ${cumple ? 'cambiar-pw__req--ok' : ''}`}>
      <span aria-hidden="true">{cumple ? '✓' : '○'}</span> {texto}
    </li>
  );
}

export default function CambiarPassword({ sesion, obligatorio, onCerrar }: CambiarPasswordProps) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  const { usuario, nombre } = sesion.usuario;
  const req = evaluar(nueva, usuario ?? '', nombre);
  const coincide = repetir.length > 0 && nueva === repetir;
  const valido = actual.length > 0 && req.largo && req.mezcla && req.sinDatos && coincide;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valido || guardando) return;
    setGuardando(true);
    setError(undefined);
    try {
      await cambiarPassword(actual, nueva);
      // La sesión se actualiza sola (onSesionChange); en modo voluntario se cierra la pantalla.
      setActual('');
      setNueva('');
      setRepetir('');
      setGuardando(false);
      onCerrar?.();
    } catch (err) {
      setError(mensajeError(err));
      setGuardando(false);
    }
  }

  const tipo = ver ? 'text' : 'password';

  return (
    <div className="cambiar-pw">
      <form className="cambiar-pw__contenido" onSubmit={enviar} noValidate>
        <div className="cambiar-pw__logo" aria-hidden="true">🔑</div>
        <h1 className="u-title-1">{obligatorio ? 'Elige tu contraseña' : 'Cambiar contraseña'}</h1>
        <p className="u-subhead cambiar-pw__intro">
          {obligatorio
            ? `Hola ${nombre.split(/\s+/)[0]}, entraste con una contraseña temporal. Crea una propia para continuar.`
            : 'Escribe tu contraseña actual y elige una nueva.'}
        </p>

        {/* Campo de usuario oculto: ayuda al gestor de contraseñas a guardar la nueva. */}
        <input type="text" value={usuario ?? ''} autoComplete="username" readOnly hidden aria-hidden="true" tabIndex={-1} />

        <label className="cambiar-pw__campo">
          <span className="u-subhead">{obligatorio ? 'Contraseña actual (la temporal)' : 'Contraseña actual'}</span>
          <input
            className="cambiar-pw__input"
            type={tipo}
            value={actual}
            onChange={(e) => { setActual(e.target.value); setError(undefined); }}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="cambiar-pw__campo">
          <span className="u-subhead">Contraseña nueva</span>
          <input
            className="cambiar-pw__input"
            type={tipo}
            value={nueva}
            onChange={(e) => { setNueva(e.target.value); setError(undefined); }}
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="cambiar-pw__campo">
          <span className="u-subhead">Repetir contraseña nueva</span>
          <input
            className="cambiar-pw__input"
            type={tipo}
            value={repetir}
            onChange={(e) => { setRepetir(e.target.value); setError(undefined); }}
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <label className="form-check cambiar-pw__ver">
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
          <span className="u-footnote">Mostrar contraseñas</span>
        </label>

        <ul className="cambiar-pw__reqs" aria-label="Requisitos de la contraseña">
          <Requisito cumple={req.largo} texto="Al menos 8 caracteres" />
          <Requisito cumple={req.mezcla} texto="Letras y números" />
          <Requisito cumple={req.sinDatos} texto="No contiene tu usuario ni tu nombre" />
          <Requisito cumple={coincide} texto="Las dos contraseñas nuevas coinciden" />
        </ul>

        {error && <p className="u-callout cambiar-pw__error" role="alert">{error}</p>}

        <button type="submit" className="cambiar-pw__guardar" disabled={!valido || guardando}>
          {guardando ? 'Guardando…' : 'Guardar contraseña'}
        </button>

        <div className="cambiar-pw__secundarias">
          {!obligatorio && onCerrar && (
            <button type="button" className="cambiar-pw__enlace" onClick={onCerrar}>Cancelar</button>
          )}
          <button type="button" className="cambiar-pw__enlace cambiar-pw__enlace--peligro" onClick={() => void cerrarSesion()}>
            Cerrar sesión
          </button>
        </div>
      </form>
    </div>
  );
}
