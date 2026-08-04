import { useId } from 'react';
import './CampoMonto.css';

interface CampoMontoProps {
  valor: string;
  onCambiar: (valor: string) => void;
  etiqueta?: string;
  tipo?: 'gasto' | 'ingreso';
  autoFocus?: boolean;
  error?: string;
}

/**
 * Campo grande de ingreso de monto, estilo teclado numérico de Wallet:
 * el símbolo de moneda fijo a la izquierda, el número tabular grande.
 * Se maneja como string en vez de number para no pelear con el cursor
 * mientras el usuario escribe '12.' o '12,5'.
 */
export default function CampoMonto({
  valor,
  onCambiar,
  etiqueta = 'Monto',
  tipo,
  autoFocus,
  error,
}: CampoMontoProps) {
  const id = useId();

  function manejarCambio(e: React.ChangeEvent<HTMLInputElement>) {
    // Solo dígitos y un separador decimal (coma o punto), como acepta validarMonto en el backend.
    const bruto = e.target.value.replace(/[^0-9.,]/g, '');
    onCambiar(bruto);
  }

  const colorTipo = tipo === 'ingreso' ? 'campo-monto--ingreso' : tipo === 'gasto' ? 'campo-monto--gasto' : '';

  return (
    <div className="campo-monto">
      <label htmlFor={id} className="u-subhead campo-monto__etiqueta">
        {etiqueta}
      </label>
      <div className={`campo-monto__caja ${colorTipo}`}>
        <span className="campo-monto__simbolo" aria-hidden="true">S/</span>
        <input
          id={id}
          className="campo-monto__input u-num"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={valor}
          onChange={manejarCambio}
          autoFocus={autoFocus}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="u-footnote campo-monto__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
