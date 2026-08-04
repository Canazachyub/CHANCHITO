#!/usr/bin/env node
/**
 * Junta todos los backend/*.js en un único build/Code.gs para pegar de una sola vez
 * en el editor web de Apps Script, sin usar clasp.
 *
 * Concatenar es seguro acá porque en Apps Script todos los archivos comparten un mismo
 * scope global: pegarlos uno detrás de otro es exactamente lo que hace el runtime al
 * cargar el proyecto. El orden alfabético de los prefijos numéricos importa porque
 * 00_config.js ejecuta asignaciones de nivel superior (ESQUEMA_COLUMNAS, SHEETS) de las
 * que dependen los demás al cargarse.
 *
 * Uso: npm run bundle
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIR_BACKEND = path.join(RAIZ, 'backend');
const DIR_SALIDA = path.join(RAIZ, 'build');
const SALIDA = path.join(DIR_SALIDA, 'Code.gs');

const archivos = fs
  .readdirSync(DIR_BACKEND)
  .filter((f) => f.endsWith('.js'))
  .sort();

if (archivos.length === 0) {
  console.error('No se encontró ningún .js en backend/');
  process.exit(1);
}

const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');

const cabecera = `/**
 * CHANCHITO v2 — backend completo en un solo archivo.
 *
 * GENERADO AUTOMÁTICAMENTE por scripts/bundle.js el ${fecha}.
 * NO editar acá: los cambios se pierden al regenerar. La fuente son los
 * ${archivos.length} archivos de backend/ — editar ahí y correr \`npm run bundle\`.
 *
 * Contiene, en este orden:
${archivos.map((f) => ` *   - ${f}`).join('\n')}
 *
 * Después de pegarlo en Apps Script:
 *   1. Cargar las propiedades de PropertiesService (docs/SETUP.md § 7).
 *   2. Ejecutar inicializarSistema() una vez.
 *   3. Desplegar como aplicación web.
 */

`;

const partes = archivos.map((nombre) => {
  const contenido = fs.readFileSync(path.join(DIR_BACKEND, nombre), 'utf8').trimEnd();
  const separador = '// '.padEnd(3) + '='.repeat(76);
  return `${separador}\n// ARCHIVO: ${nombre}\n${separador}\n\n${contenido}\n`;
});

fs.mkdirSync(DIR_SALIDA, { recursive: true });
fs.writeFileSync(SALIDA, cabecera + partes.join('\n'), 'utf8');

const bytes = fs.statSync(SALIDA).size;
const lineas = fs.readFileSync(SALIDA, 'utf8').split('\n').length;

console.log(`build/Code.gs generado`);
console.log(`  ${archivos.length} archivos · ${lineas.toLocaleString('es')} líneas · ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  Pegarlo en un único archivo del editor de Apps Script.`);
