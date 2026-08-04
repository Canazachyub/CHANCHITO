import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Boton.css';

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';
type Tamano = 'normal' | 'chico';

interface BotonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variante?: Variante;
  tamano?: Tamano;
  children: ReactNode;
  /** Ancho completo del contenedor — para acciones principales de formulario. */
  bloque?: boolean;
}

export default function Boton({
  variante = 'primario',
  tamano = 'normal',
  bloque = false,
  children,
  ...resto
}: BotonProps) {
  const clases = ['boton', `boton--${variante}`, `boton--${tamano}`, bloque ? 'boton--bloque' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button className={clases} {...resto}>
      {children}
    </button>
  );
}

interface BotonIconoProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variante?: Variante;
  children: ReactNode;
  /** Obligatorio: un botón de solo ícono sin aria-label es invisible para lectores de pantalla. */
  'aria-label': string;
}

/** Botón circular de solo ícono, siempre 44x44 como mínimo (target táctil). */
export function BotonIcono({ variante = 'fantasma', children, ...resto }: BotonIconoProps) {
  return (
    <button className={`boton-icono boton-icono--${variante}`} {...resto}>
      {children}
    </button>
  );
}
