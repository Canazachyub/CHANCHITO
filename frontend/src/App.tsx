import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { Sesion } from './data/types';
import { getSesion, onSesionChange } from './data/api';
import Login from './screens/Login';
import CambiarPassword from './screens/CambiarPassword';
import Gastos, { type FiltroInicialGastos } from './screens/Gastos';
import Deudas from './screens/Deudas';
import Admin from './screens/Admin';
import Conflictos from './screens/Conflictos';
import InicioMovil from './screens/InicioMovil';
import MasMovil from './screens/MasMovil';
import TabBar from './components/TabBar';
import BarraLateral from './components/BarraLateral';
import BarraSuperiorMovil from './components/BarraSuperiorMovil';
import { useEsMovil } from './components/useEsMovil';
import './components/Shell.css';

// Carga diferida: ECharts (Resumen) y el Tablero salen del chunk principal.
const Resumen = lazy(() => import('./screens/Resumen'));
const Tablero = lazy(() => import('./screens/Tablero'));
const Auditoria = lazy(() => import('./screens/Auditoria'));

const Cargando = <div className="u-skeleton" style={{ height: 240 }} aria-hidden="true" />;

/**
 * 'inicio' y 'mas' solo existen en el móvil (< 768px, DESIGN § 8.1); en el móvil 'resumen' se
 * muestra como "Análisis" y 'gastos' como "Movimientos".
 */
export type Tab = 'inicio' | 'resumen' | 'gastos' | 'deudas' | 'mas' | 'tablero' | 'auditoria' | 'admin';

const CLAVE_BARRA = 'chanchito.barra_colapsada';

function leerBarraColapsada(): boolean {
  try {
    return localStorage.getItem(CLAVE_BARRA) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const esMovil = useEsMovil();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<Tab>(() => (window.matchMedia('(max-width: 767.98px)').matches ? 'inicio' : 'resumen'));
  const [mostrarCuenta, setMostrarCuenta] = useState(false);
  const [colapsada, setColapsada] = useState<boolean>(leerBarraColapsada);
  // Filtros con los que se (re)abre Movimientos; `clave` remonta la pantalla si ya estaba abierta.
  const [filtroGastos, setFiltroGastos] = useState<{ clave: number; inicial?: FiltroInicialGastos }>({ clave: 0 });
  const contadorGastos = useRef(0);

  useEffect(() => {
    getSesion().then((s) => {
      setSesion(s);
      setCargando(false);
    });
    return onSesionChange(setSesion);
  }, []);

  function alternarBarra() {
    const siguiente = !colapsada;
    setColapsada(siguiente);
    try {
      localStorage.setItem(CLAVE_BARRA, siguiente ? '1' : '0');
    } catch {
      /* sin almacenamiento: la preferencia vale solo para esta sesión */
    }
  }

  /** Va a Movimientos, con filtros iniciales opcionales (rueda de categorías, lupa). */
  function irAMovimientos(inicial?: FiltroInicialGastos) {
    contadorGastos.current += 1;
    setFiltroGastos({ clave: contadorGastos.current, inicial });
    setTab('gastos');
  }

  function cambiarTab(siguiente: Tab) {
    if (siguiente === 'gastos') irAMovimientos();
    else setTab(siguiente);
  }

  if (cargando) return null;
  if (!sesion) return <Login onEntrar={setSesion} />;

  // Contraseña temporal: pantalla bloqueante antes de cualquier pestaña.
  if (sesion.usuario.debe_cambiar_password === true) {
    return <CambiarPassword sesion={sesion} obligatorio />;
  }
  if (mostrarCuenta) {
    return <CambiarPassword sesion={sesion} obligatorio={false} onCerrar={() => setMostrarCuenta(false)} />;
  }

  const esPropietario = sesion.usuario.rol_global === 'propietario';
  // Inicio y Más no existen en web/tablet: si se agranda la pantalla estando en ellas, cae en Resumen.
  const tabActiva: Tab = !esMovil && (tab === 'inicio' || tab === 'mas') ? 'resumen' : tab;

  return (
    <div className={`shell ${colapsada ? 'shell--colapsada' : ''}`}>
      <BarraLateral
        sesion={sesion}
        activo={tabActiva}
        onCambiar={cambiarTab}
        mostrarAdmin={esPropietario}
        colapsada={colapsada}
        onAlternar={alternarBarra}
        onCuenta={() => setMostrarCuenta(true)}
      />
      <BarraSuperiorMovil
        esPropietario={esPropietario}
        onBuscar={() => irAMovimientos({ buscar: true })}
        onCampana={() => setTab(esPropietario ? 'auditoria' : 'deudas')}
      />
      <main className="app-scroll">
        <Conflictos />
        <Suspense fallback={Cargando}>
          {tabActiva === 'resumen' && <Resumen sesion={sesion} />}
          {tabActiva === 'tablero' && esPropietario && <Tablero />}
          {tabActiva === 'auditoria' && esPropietario && <Auditoria onIr={setTab} />}
        </Suspense>
        {tabActiva === 'inicio' && (
          <InicioMovil
            sesion={sesion}
            onVerMovimientos={({ categoria, mes, anio }) => irAMovimientos({ categoria, mes, anio })}
          />
        )}
        {tabActiva === 'gastos' && <Gastos key={filtroGastos.clave} sesion={sesion} inicial={filtroGastos.inicial} />}
        {tabActiva === 'deudas' && <Deudas sesion={sesion} />}
        {tabActiva === 'mas' && <MasMovil sesion={sesion} esPropietario={esPropietario} onIr={setTab} onCuenta={() => setMostrarCuenta(true)} />}
        {tabActiva === 'admin' && esPropietario && <Admin sesion={sesion} />}
      </main>
      <TabBar activo={tabActiva} onCambiar={cambiarTab} mostrarAdmin={esPropietario} />
    </div>
  );
}
