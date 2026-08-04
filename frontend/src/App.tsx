import { useEffect, useState } from 'react';
import type { Sesion } from './data/types';
import { getSesion, onSesionChange } from './data/api';
import Login from './screens/Login';
import Resumen from './screens/Resumen';
import Gastos from './screens/Gastos';
import Deudas from './screens/Deudas';
import Admin from './screens/Admin';
import Conflictos from './screens/Conflictos';
import TabBar from './components/TabBar';

export type Tab = 'resumen' | 'gastos' | 'deudas' | 'admin';

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<Tab>('resumen');

  useEffect(() => {
    getSesion().then((s) => {
      setSesion(s);
      setCargando(false);
    });
    return onSesionChange(setSesion);
  }, []);

  if (cargando) return null;
  if (!sesion) return <Login onEntrar={setSesion} />;

  const esPropietario = sesion.usuario.rol_global === 'propietario';

  return (
    <>
      <main className="app-scroll">
        <Conflictos />
        {tab === 'resumen' && <Resumen sesion={sesion} />}
        {tab === 'gastos' && <Gastos sesion={sesion} />}
        {tab === 'deudas' && <Deudas sesion={sesion} />}
        {tab === 'admin' && esPropietario && <Admin sesion={sesion} />}
      </main>
      <TabBar activo={tab} onCambiar={setTab} mostrarAdmin={esPropietario} />
    </>
  );
}
