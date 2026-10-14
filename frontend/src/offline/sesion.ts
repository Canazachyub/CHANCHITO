/**
 * Sesión persistida (CONTRACT § 3 "Sesión"). Se guarda en Dexie para sobrevivir a cierres
 * de la PWA sin conexión, y se expone con un patrón observable simple para que App.tsx
 * reaccione (login, logout, o expulsión por SESION_INVALIDA) sin tener que sondear.
 *
 * Nota de diseño: este módulo y data/cliente.ts se importan mutuamente (cliente.ts necesita
 * leer/limpiar la sesión en cada request; sesion.ts necesita pegarle a `login`). Es seguro en
 * ESM porque ninguno de los dos usa el import del otro al nivel de módulo, solo dentro de
 * funciones que se llaman en tiempo de ejecución, cuando ambos módulos ya terminaron de cargar.
 */
import type { Sesion } from '../data/types';
import { cambiarPasswordRemoto, login, loginPassword, type DatosLogin } from '../data/cliente';
import { db } from './db';

const CLAVE = 'actual' as const;

const suscriptores = new Set<(s: Sesion | null) => void>();

function notificar(s: Sesion | null): void {
  for (const cb of suscriptores) cb(s);
}

function haExpirado(expira: string): boolean {
  // 'expira' llega con el mismo formato 'yyyy-MM-dd HH:mm:ss' que el resto de fechas del backend
  // (backend/02_util.js fechaHoraActual). Date no lo parsea de forma confiable sin la 'T'.
  const normalizado = expira.includes('T') ? expira : expira.replace(' ', 'T');
  const t = new Date(normalizado).getTime();
  if (Number.isNaN(t)) return false; // si no se puede interpretar, que decida el servidor (SESION_INVALIDA)
  return t < Date.now();
}

export async function getSesion(): Promise<Sesion | null> {
  const fila = await db.sesion.get(CLAVE);
  if (!fila) return null;
  if (haExpirado(fila.valor.expira)) {
    await db.sesion.delete(CLAVE);
    return null;
  }
  return fila.valor;
}

export function onSesionChange(cb: (s: Sesion | null) => void): () => void {
  suscriptores.add(cb);
  return () => {
    suscriptores.delete(cb);
  };
}

export async function iniciarSesion(idTokenGoogle: string): Promise<Sesion> {
  return guardarSesion(await login(idTokenGoogle));
}

/** CONTRACT § 0.1-bis: usuario y contraseña propios, sin depender de Google. */
export async function iniciarSesionConPassword(usuario: string, password: string): Promise<Sesion> {
  return guardarSesion(await loginPassword(usuario.trim().toLowerCase(), password));
}

/** Tras cambiarla, la sesión sigue: solo se actualiza el usuario (ya sin debe_cambiar_password). */
export async function cambiarPassword(actual: string, nueva: string): Promise<Sesion> {
  const fila = await db.sesion.get(CLAVE);
  if (!fila) throw new Error('No hay sesión activa');
  const usuario = await cambiarPasswordRemoto(actual, nueva);
  const sesion: Sesion = { ...fila.valor, usuario };
  await db.sesion.put({ clave: CLAVE, valor: sesion });
  await db.usuarios.put(usuario);
  notificar(sesion);
  return sesion;
}

async function guardarSesion(datos: DatosLogin): Promise<Sesion> {
  const sesion: Sesion = { usuario: datos.usuario, token_sesion: datos.token_sesion, expira: datos.expira };
  await db.sesion.put({ clave: CLAVE, valor: sesion });
  // Se guarda también en la tabla de usuarios para que useUsuarios() tenga al menos a quien
  // inició sesión antes de la primera sincronización completa.
  await db.usuarios.put(sesion.usuario);
  notificar(sesion);
  return sesion;
}

export async function cerrarSesion(): Promise<void> {
  await db.sesion.delete(CLAVE);
  notificar(null);
}
