import { cambiarEspacio, useEspacioActivo, useEspacios } from '../data/api';
import './SelectorEspacio.css';

/**
 * Control segmentado fijo arriba de Resumen, Gastos y Deudas (CONTRACT § 6): "tiene que ser
 * imposible mirar la pantalla y no saber en qué libro estás". Reutiliza el mismo patrón visual
 * que el chip gasto/ingreso de los formularios (fondo tenue + segmento activo elevado con el
 * color de acento) en vez de inventar una paleta nueva por espacio — el contrato solo permite
 * los tokens de color ya declarados.
 */
export default function SelectorEspacio() {
  const espacios = useEspacios();
  const activo = useEspacioActivo();

  if (espacios === undefined || activo === undefined) {
    return <div className="u-skeleton selector-espacio__esqueleto" aria-hidden="true" />;
  }

  return (
    <div className="selector-espacio" role="tablist" aria-label="Espacio activo">
      {espacios.map((e) => {
        const seleccionado = e.id_espacio === activo.id_espacio;
        return (
          <button
            key={e.id_espacio}
            type="button"
            role="tab"
            aria-selected={seleccionado}
            className={`selector-espacio__opcion ${seleccionado ? 'selector-espacio__opcion--activo' : ''}`}
            onClick={() => {
              if (!seleccionado) void cambiarEspacio(e.id_espacio);
            }}
          >
            <span aria-hidden="true">{e.icono}</span>
            {e.nombre}
          </button>
        );
      })}
    </div>
  );
}
