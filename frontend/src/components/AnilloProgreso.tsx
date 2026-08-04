import './AnilloProgreso.css';

interface AnilloProgresoProps {
  /** 0..1 */
  proporcion: number;
  color: string;
  tamano?: number;
  grosor?: number;
  children?: React.ReactNode;
}

/**
 * Anillo de progreso SVG propio (sin librería). stroke-dasharray se anima
 * vía CSS transition sobre stroke-dashoffset, así que basta con cambiar la
 * prop `proporcion` para que el anillo "llene" suavemente.
 * Pensado para usarse solo o apilado en una leyenda; se ve bien tanto con
 * 3 categorías (anillos grandes) como con 10 (versión chica en fila).
 */
export default function AnilloProgreso({
  proporcion,
  color,
  tamano = 64,
  grosor = 8,
  children,
}: AnilloProgresoProps) {
  const radio = (tamano - grosor) / 2;
  const circunferencia = 2 * Math.PI * radio;
  const clamped = Math.min(1, Math.max(0, proporcion));
  const offset = circunferencia * (1 - clamped);

  return (
    <div className="anillo-progreso" style={{ width: tamano, height: tamano }}>
      <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} role="img" aria-hidden={children ? undefined : true}>
        <circle
          className="anillo-progreso__pista"
          cx={tamano / 2}
          cy={tamano / 2}
          r={radio}
          strokeWidth={grosor}
          fill="none"
        />
        <circle
          className="anillo-progreso__valor"
          cx={tamano / 2}
          cy={tamano / 2}
          r={radio}
          strokeWidth={grosor}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`}
        />
      </svg>
      {children && <div className="anillo-progreso__contenido">{children}</div>}
    </div>
  );
}
