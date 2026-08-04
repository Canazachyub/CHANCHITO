import { formatMoneda, nombreMes } from '../design/format';
import './TarjetaHero.css';

interface TarjetaHeroProps {
  mes: number;
  anio: number;
  saldo: number;
  totalIngresos: number;
  totalGastos: number;
}

/**
 * La única superficie con vidrio esmerilado de toda la app (regla del
 * sistema de diseño). Se apoya sobre un degradé sutil derivado de
 * --accent/--income/--expense con opacidad baja para que el blur tenga
 * algo de textura detrás; sin esos halos el blur no se nota sobre --bg
 * plano.
 */
export default function TarjetaHero({ mes, anio, saldo, totalIngresos, totalGastos }: TarjetaHeroProps) {
  const positivo = saldo >= 0;

  return (
    <section className="tarjeta-hero u-vidrio" aria-label="Saldo del mes">
      <div className="tarjeta-hero__halo tarjeta-hero__halo--a" aria-hidden="true" />
      <div className="tarjeta-hero__halo tarjeta-hero__halo--b" aria-hidden="true" />
      <div className="tarjeta-hero__contenido">
        <p className="u-subhead tarjeta-hero__periodo">
          {nombreMes(mes)} {anio}
        </p>
        <p className={`u-amount-lg u-num tarjeta-hero__saldo ${positivo ? 'u-income' : 'u-expense'}`}>
          {formatMoneda(saldo)}
        </p>
        <div className="tarjeta-hero__resumen">
          <div className="tarjeta-hero__dato">
            <span className="tarjeta-hero__punto tarjeta-hero__punto--ingreso" aria-hidden="true" />
            <span className="u-footnote">Ingresos</span>
            <span className="u-amount u-num u-income">{formatMoneda(totalIngresos)}</span>
          </div>
          <div className="tarjeta-hero__dato">
            <span className="tarjeta-hero__punto tarjeta-hero__punto--gasto" aria-hidden="true" />
            <span className="u-footnote">Gastos</span>
            <span className="u-amount u-num u-expense">{formatMoneda(totalGastos)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
