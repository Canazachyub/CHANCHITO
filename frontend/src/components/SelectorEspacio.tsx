import { useEffect } from 'react';
import { cambiarEspacio, useEspacioActivo, useEspacios } from '../data/api';
import './SelectorEspacio.css';

/**
 * Control segmentado fijo arriba de Resumen, Gastos y Deudas (CONTRACT § 6): "tiene que ser
 * imposible mirar la pantalla y no saber en qué libro estás". El segmento activo se rellena con
 * el acento del libro (Familia cian, Telcom ámbar, DESIGN § 2.2) y además fija html[data-libro].
 */
export default function SelectorEspacio() {
  const espacios = useEspacios();
  const activo = useEspacioActivo();
  const idActivo = activo?.id_espacio;

  // Tiñe --accent (y el filo de los bloques) con el color del libro activo (DESIGN § 3.3).
  useEffect(() => {
    if (idActivo === undefined) return;
    document.documentElement.dataset.libro = idActivo === 'ESP_TELCOM' ? 'telcom' : 'familia';
  }, [idActivo]);

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
