import { useEffect, type ReactNode } from 'react';
import Boton, { BotonIcono } from './Boton';
import './Modal.css';

interface ModalProps {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  children: ReactNode;
}

/**
 * Hoja modal que sube desde abajo (patrón iOS). Se monta/desmonta según
 * `abierto` para no arrastrar formularios vacíos en el DOM entre usos.
 */
export default function Modal({ abierto, onCerrar, titulo, children }: ModalProps) {
  useEffect(() => {
    if (!abierto) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    function alEscapar(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', alEscapar);
    return () => window.removeEventListener('keydown', alEscapar);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div
        className="modal-hoja"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-hoja__agarre" aria-hidden="true" />
        <div className="modal-hoja__cabecera">
          <h2 className="u-title-3">{titulo}</h2>
          <BotonIcono aria-label="Cerrar" onClick={onCerrar}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </BotonIcono>
        </div>
        <div className="modal-hoja__contenido">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmacionProps {
  abierto: boolean;
  titulo: string;
  mensaje: string;
  textoConfirmar?: string;
  peligro?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Diálogo de confirmación compacto (borrar, desactivar), montado sobre el mismo patrón de hoja. */
export function Confirmacion({
  abierto,
  titulo,
  mensaje,
  textoConfirmar = 'Confirmar',
  peligro = false,
  onConfirmar,
  onCancelar,
}: ConfirmacionProps) {
  if (!abierto) return null;

  return (
    <div className="modal-fondo" onClick={onCancelar}>
      <div
        className="modal-confirmacion"
        role="alertdialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="u-title-3">{titulo}</h2>
        <p className="u-callout modal-confirmacion__mensaje">{mensaje}</p>
        <div className="modal-confirmacion__acciones">
          <Boton variante="secundario" bloque onClick={onCancelar}>
            Cancelar
          </Boton>
          <Boton variante={peligro ? 'peligro' : 'primario'} bloque onClick={onConfirmar}>
            {textoConfirmar}
          </Boton>
        </div>
      </div>
    </div>
  );
}
