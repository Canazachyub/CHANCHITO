import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Sesion, TipoMovimiento } from '../data/types';
import {
  crearDeuda,
  crearTransaccion,
  useCategorias,
  useCuentas,
  useTrabajadores,
  useUsoCategorias,
  useUsuarios,
} from '../data/api';
import { evaluar, pulsar, tieneOperacion } from '../data/calculadora';
import { fechaYmd, ordenarPorUso } from '../data/periodo';
import { formatMoneda } from '../design/format';
import './HojaRegistro.css';

interface HojaRegistroProps {
  abierto: boolean;
  /** Tipo con el que se abre (− Gasto / + Ingreso / ícono de la rueda). */
  tipoInicial: TipoMovimiento;
  /** Categoría ya elegida (toque en un ícono de la rueda). */
  categoriaInicial?: string;
  /** Monto con el que arranca el teclado (sugerencia "repetir"); sigue siendo editable. */
  montoInicial?: number;
  /** Descripción prellenada (va a la nota). */
  notaInicial?: string;
  /** Trabajador preelegido (sugerencia de personal). */
  trabajadorInicial?: string;
  sesion: Sesion;
  onCerrar: () => void;
}

/** Misma regla que Gastos.tsx (CONTRACT § 6-bis): el adelanto deja además una deuda me_deben. */
const CATEGORIA_ADELANTOS = 'Adelantos';
const VISIBLES_INICIALES = 7;
const UMBRAL_CIERRE = 110;

/** Última día del mes de 'yyyy-MM-dd': plazo por defecto para descontar un adelanto. */
function finDeMes(fechaIso: string): string {
  const [anio, mes] = fechaIso.split('-').map(Number);
  return `${anio}-${String(mes).padStart(2, '0')}-${new Date(anio, mes, 0).getDate()}`;
}

const TECLAS: Array<{ t: string; clase?: string; etiqueta?: string }> = [
  { t: '7' }, { t: '8' }, { t: '9' }, { t: '÷', clase: 'op' }, { t: '⌫', clase: 'op' },
  { t: '4' }, { t: '5' }, { t: '6' }, { t: '×', clase: 'op' }, { t: '=', clase: 'igual' },
  { t: '1' }, { t: '2' }, { t: '3' }, { t: '−', clase: 'op' },
  { t: '.' }, { t: '0' }, { t: 'C', clase: 'op' }, { t: '+', clase: 'op' },
];

/**
 * Hoja de registro (DESIGN § 8.1): bottom sheet con monto + teclado calculadora, grilla de
 * categorías (las más usadas primero), cuenta, de quién, trabajador (solo personal), nota y fecha.
 * Guarda con crearTransaccion, igual que Gastos: los datos son idénticos desde cualquier pantalla.
 * Se queda montada aunque esté cerrada para que el aviso "Guardado" sobreviva al cierre.
 */
export default function HojaRegistro({ abierto, tipoInicial, categoriaInicial, montoInicial, notaInicial, trabajadorInicial, sesion, onCerrar }: HojaRegistroProps) {
  const [tipo, setTipo] = useState<TipoMovimiento>(tipoInicial);
  const [expr, setExpr] = useState('');
  const [idCategoria, setIdCategoria] = useState('');
  const [idCuenta, setIdCuenta] = useState('');
  const [idUsuario, setIdUsuario] = useState(sesion.usuario.id_usuario);
  const [idTrabajador, setIdTrabajador] = useState('');
  const [nota, setNota] = useState('');
  const [fecha, setFecha] = useState(() => fechaYmd(new Date()));
  const [descontar, setDescontar] = useState(true);
  const [verTodas, setVerTodas] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [toast, setToast] = useState(false);
  const [arrastre, setArrastre] = useState(0);

  const categorias = useCategorias(tipo);
  const uso = useUsoCategorias(tipo);
  const cuentas = useCuentas();
  const usuarios = useUsuarios();
  const trabajadores = useTrabajadores();

  const inicio = useRef<{ y: number; t: number } | null>(null);
  const temporizadores = useRef<number[]>([]);

  // Cada apertura parte de cero (el componente no se desmonta entre usos).
  useEffect(() => {
    if (!abierto) return;
    setTipo(tipoInicial);
    setExpr(montoInicial ? String(Math.round(montoInicial * 100) / 100) : '');
    setIdCategoria(categoriaInicial ?? '');
    setIdCuenta('');
    setIdUsuario(sesion.usuario.id_usuario);
    setIdTrabajador(trabajadorInicial ?? '');
    setNota(notaInicial ?? '');
    setFecha(fechaYmd(new Date()));
    setDescontar(true);
    setVerTodas(false);
    setError(undefined);
    setGuardando(false);
    setExito(false);
    setCerrando(false);
    setArrastre(0);
  }, [abierto, tipoInicial, categoriaInicial, montoInicial, notaInicial, trabajadorInicial, sesion.usuario.id_usuario]);

  useEffect(() => () => temporizadores.current.forEach((id) => window.clearTimeout(id)), []);

  const cerrar = useCallback(() => {
    setCerrando(true);
    temporizadores.current.push(window.setTimeout(onCerrar, 180));
  }, [onCerrar]);

  // Esc cierra; el cuerpo no se desplaza detrás de la hoja.
  useEffect(() => {
    if (!abierto) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cerrar();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (/^[0-9.,]$/.test(e.key)) setExpr((x) => pulsar(x, e.key));
      else if (e.key === 'Backspace') setExpr((x) => pulsar(x, '⌫'));
      else if (['+', '-', '*', '/'].includes(e.key)) setExpr((x) => pulsar(x, { '+': '+', '-': '−', '*': '×', '/': '÷' }[e.key]!));
      else if (e.key === '=') setExpr((x) => pulsar(x, '='));
    }
    window.addEventListener('keydown', alTeclear);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', alTeclear);
    };
  }, [abierto, cerrar]);

  const ordenadas = useMemo(() => ordenarPorUso(categorias ?? [], uso), [categorias, uso]);
  const visibles = useMemo(() => {
    if (verTodas || ordenadas.length <= VISIBLES_INICIALES) return ordenadas;
    const primeras = ordenadas.slice(0, VISIBLES_INICIALES);
    const elegida = ordenadas.find((c) => c.id_categoria === idCategoria);
    return elegida && !primeras.includes(elegida) ? [...primeras.slice(0, VISIBLES_INICIALES - 1), elegida] : primeras;
  }, [ordenadas, verTodas, idCategoria]);

  const categoria = (categorias ?? []).find((c) => c.id_categoria === idCategoria);
  const esPersonal = categoria?.grupo === 'personal';
  const esAdelanto = categoria?.nombre === CATEGORIA_ADELANTOS;
  const cuentaEfectiva = idCuenta || cuentas?.[0]?.id_cuenta || '';
  const resultado = evaluar(expr);
  const hayOperacion = tieneOperacion(expr);

  function tecla(t: string) {
    setError(undefined);
    setExpr((x) => pulsar(x, t));
  }

  async function guardar() {
    if (guardando || exito) return;
    if (!resultado.ok || resultado.valor <= 0) {
      setError(resultado.ok ? 'Ingresa un monto mayor que cero.' : resultado.error);
      return;
    }
    if (!idCategoria) {
      setError('Elige una categoría.');
      return;
    }
    if (!cuentaEfectiva) {
      setError('No hay una cuenta disponible.');
      return;
    }
    const trabajador = esPersonal ? idTrabajador : '';
    if (esAdelanto && descontar && !trabajador) {
      setError('Elige a qué trabajador se le dio el adelanto para poder descontarlo.');
      return;
    }

    setGuardando(true);
    try {
      const monto = resultado.valor;
      await crearTransaccion({
        id_usuario: idUsuario || sesion.usuario.id_usuario,
        id_trabajador: trabajador,
        id_cuenta: cuentaEfectiva,
        id_categoria: idCategoria,
        tipo,
        monto,
        descripcion: nota,
        fecha,
        hora: new Date().toTimeString().slice(0, 8),
        ubicacion: '',
        notas: '',
      });
      if (esAdelanto && descontar && trabajador) {
        const persona = (trabajadores ?? []).find((w) => w.id_trabajador === trabajador)?.nombre ?? 'Trabajador';
        await crearDeuda({
          tipo: 'me_deben',
          persona,
          monto_original: monto,
          descripcion: `Adelanto por descontar${nota ? `: ${nota}` : ''}`,
          fecha_vencimiento: finDeMes(fecha),
          recordatorio: false,
          id_trabajador: trabajador,
        });
      }
      try {
        navigator.vibrate?.(15);
      } catch {
        /* sin vibración: no pasa nada */
      }
      setExito(true);
      setToast(true);
      temporizadores.current.push(window.setTimeout(() => setToast(false), 2200));
      temporizadores.current.push(window.setTimeout(cerrar, 420));
    } catch {
      setGuardando(false);
      setError('No se pudo guardar. Intenta de nuevo.');
    }
  }

  // Arrastre hacia abajo desde el asa/cabecera.
  function iniciarArrastre(e: React.PointerEvent) {
    inicio.current = { y: e.clientY, t: Date.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moverArrastre(e: React.PointerEvent) {
    if (!inicio.current) return;
    setArrastre(Math.max(0, e.clientY - inicio.current.y));
  }
  function terminarArrastre(e: React.PointerEvent) {
    if (!inicio.current) return;
    const dy = e.clientY - inicio.current.y;
    const veloz = dy / Math.max(1, Date.now() - inicio.current.t) > 0.6;
    inicio.current = null;
    if (dy > UMBRAL_CIERRE || (veloz && dy > 40)) cerrar();
    else setArrastre(0);
  }

  const claseTipo = tipo === 'gasto' ? 'hoja-registro--gasto' : 'hoja-registro--ingreso';

  return (
    <>
      {abierto && (
        <div className={`hoja-registro__fondo ${cerrando ? 'hoja-registro__fondo--saliendo' : ''}`} onClick={cerrar}>
          <div
            className={`hoja-registro ${claseTipo} ${cerrando ? 'hoja-registro--saliendo' : ''} ${arrastre > 0 ? 'hoja-registro--arrastrando' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={tipo === 'gasto' ? 'Registrar gasto' : 'Registrar ingreso'}
            style={arrastre > 0 ? { transform: `translateY(${arrastre}px)` } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="hoja-registro__agarre"
              onPointerDown={iniciarArrastre}
              onPointerMove={moverArrastre}
              onPointerUp={terminarArrastre}
              onPointerCancel={terminarArrastre}
            >
              <span className="hoja-registro__asa" aria-hidden="true" />
              <div className="hoja-registro__tipos" role="group" aria-label="Tipo de movimiento" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`hoja-registro__tipo ${tipo === 'gasto' ? 'hoja-registro__tipo--gasto' : ''}`}
                  aria-pressed={tipo === 'gasto'}
                  onClick={() => { setTipo('gasto'); setIdCategoria(''); setIdTrabajador(''); }}
                >
                  − Gasto
                </button>
                <button
                  type="button"
                  className={`hoja-registro__tipo ${tipo === 'ingreso' ? 'hoja-registro__tipo--ingreso' : ''}`}
                  aria-pressed={tipo === 'ingreso'}
                  onClick={() => { setTipo('ingreso'); setIdCategoria(''); setIdTrabajador(''); }}
                >
                  + Ingreso
                </button>
              </div>
            </div>

            <div className="hoja-registro__cuerpo">
              <div className={`hoja-registro__monto ${exito ? 'hoja-registro__monto--ok' : ''}`} aria-live="polite">
                <span className="hoja-registro__moneda">S/</span>
                <span className="hoja-registro__valor u-num">{expr === '' ? '0' : expr}</span>
                {exito && <span className="hoja-registro__visto" aria-hidden="true">✓</span>}
              </div>
              <p className="hoja-registro__calculo u-footnote u-num" aria-live="polite">
                {hayOperacion && resultado.ok ? `= ${formatMoneda(resultado.valor)}` : hayOperacion && !resultado.ok ? resultado.error : ' '}
              </p>

              <div className="hoja-registro__teclado" role="group" aria-label="Teclado calculadora">
                {TECLAS.map((k) => (
                  <button
                    key={k.t}
                    type="button"
                    className={`hoja-registro__tecla ${k.clase ? `hoja-registro__tecla--${k.clase}` : ''}`}
                    onClick={() => tecla(k.t)}
                    aria-label={k.t === '⌫' ? 'Borrar' : k.t === 'C' ? 'Limpiar' : k.t === '.' ? 'Punto decimal' : k.t === '=' ? 'Calcular' : k.t}
                  >
                    {k.t}
                  </button>
                ))}
              </div>

              <p className="u-micro hoja-registro__rotulo">Categoría</p>
              {categorias === undefined ? (
                <div className="u-skeleton" style={{ height: 88 }} aria-hidden="true" />
              ) : (
                <div className="hoja-registro__categorias" role="radiogroup" aria-label="Categoría">
                  {visibles.map((c) => (
                    <button
                      key={c.id_categoria}
                      type="button"
                      role="radio"
                      aria-checked={c.id_categoria === idCategoria}
                      className={`hoja-registro__categoria ${c.id_categoria === idCategoria ? 'hoja-registro__categoria--activa' : ''}`}
                      onClick={() => { setIdCategoria(c.id_categoria); setError(undefined); if (c.grupo !== 'personal') setIdTrabajador(''); }}
                    >
                      <span className="hoja-registro__categoria-icono" aria-hidden="true">{c.icono}</span>
                      <span className="hoja-registro__categoria-nombre">{c.nombre}</span>
                    </button>
                  ))}
                  {ordenadas.length > VISIBLES_INICIALES && (
                    <button type="button" className="hoja-registro__categoria hoja-registro__categoria--mas" onClick={() => setVerTodas((v) => !v)}>
                      <span className="hoja-registro__categoria-icono" aria-hidden="true">{verTodas ? '▴' : '▾'}</span>
                      <span className="hoja-registro__categoria-nombre">{verTodas ? 'Menos' : 'Más'}</span>
                    </button>
                  )}
                </div>
              )}

              <div className="hoja-registro__campos">
                <label className="hoja-registro__campo">
                  <span className="u-micro">Cuenta</span>
                  <select className="hoja-registro__control" value={cuentaEfectiva} onChange={(e) => setIdCuenta(e.target.value)}>
                    {(cuentas ?? []).map((c) => (
                      <option key={c.id_cuenta} value={c.id_cuenta}>{c.icono} {c.nombre}</option>
                    ))}
                  </select>
                </label>
                <label className="hoja-registro__campo">
                  <span className="u-micro">De quién</span>
                  <select className="hoja-registro__control" value={idUsuario} onChange={(e) => setIdUsuario(e.target.value)}>
                    {(usuarios ?? []).map((u) => (
                      <option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>
                    ))}
                  </select>
                </label>
                {esPersonal && (
                  <label className="hoja-registro__campo hoja-registro__campo--ancho">
                    <span className="u-micro">Trabajador</span>
                    <select className="hoja-registro__control" value={idTrabajador} onChange={(e) => setIdTrabajador(e.target.value)}>
                      <option value="">Sin asignar</option>
                      {(trabajadores ?? []).map((w) => (
                        <option key={w.id_trabajador} value={w.id_trabajador}>{w.nombre}</option>
                      ))}
                    </select>
                  </label>
                )}
                {esAdelanto && (
                  <label className="hoja-registro__campo hoja-registro__campo--ancho hoja-registro__check">
                    <input type="checkbox" checked={descontar} onChange={(e) => setDescontar(e.target.checked)} />
                    <span className="u-footnote">Descontar luego (crea una deuda por cobrar)</span>
                  </label>
                )}
                <label className="hoja-registro__campo hoja-registro__campo--ancho">
                  <span className="u-micro">Nota</span>
                  <input
                    className="hoja-registro__control"
                    type="text"
                    placeholder="Opcional"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="hoja-registro__campo hoja-registro__campo--ancho">
                  <span className="u-micro">Fecha</span>
                  <input className="hoja-registro__control" type="date" value={fecha} onChange={(e) => setFecha(e.target.value || fechaYmd(new Date()))} />
                </label>
              </div>
            </div>

            <div className="hoja-registro__pie">
              {error && (
                <p className="hoja-registro__error u-footnote" role="alert">{error}</p>
              )}
              <button type="button" className="hoja-registro__guardar" onClick={guardar} disabled={guardando}>
                {exito ? '✓ Guardado' : guardando ? 'Guardando…' : tipo === 'gasto' ? 'Guardar gasto' : 'Guardar ingreso'}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="hoja-registro__toast" role="status">
          <span aria-hidden="true">✓</span> Guardado
        </div>
      )}
    </>
  );
}
