/**
 * Tests de backend/lib_password.js — contraseñas propias (CONTRACT § 0.1-bis).
 * El SHA-256 se inyecta desde node:crypto, igual que en Apps Script sale de Utilities.
 */
const crypto = require('crypto');
const lib = require('../backend/lib_password.js');

const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

describe('normalizarUsuario', () => {
  it('pasa a minúsculas, recorta y valida formato', () => {
    expect(lib.normalizarUsuario('  Darwin.Canaza ')).toBe('darwin.canaza');
    expect(lib.normalizarUsuario('willy_2')).toBe('willy_2');
  });
  it('rechaza cortos, con espacios o símbolos raros', () => {
    expect(lib.normalizarUsuario('ab')).toBeNull();
    expect(lib.normalizarUsuario('jael canaza')).toBeNull();
    expect(lib.normalizarUsuario('yubert@x')).toBeNull();
    expect(lib.normalizarUsuario('.yubert')).toBeNull();
    expect(lib.normalizarUsuario(null)).toBeNull();
  });
});

describe('validarPasswordNueva', () => {
  const ctx = { usuario: 'darwin', nombre: 'Darwin Canaza Chique' };
  it('acepta una contraseña razonable', () => {
    expect(lib.validarPasswordNueva('Mochila42verde', ctx).valido).toBe(true);
  });
  it.each([
    ['corta1', 'al menos'],
    ['soloLetrasLargas', 'letras y números'],
    ['12345678901', 'letras y números'],
    ['password1', 'común'],
    ['darwin2026x', 'usuario ni tu nombre'],
    ['canaza1234', 'usuario ni tu nombre'],
  ])('rechaza %s', (pw, motivo) => {
    const r = lib.validarPasswordNueva(pw, ctx);
    expect(r.valido).toBe(false);
    expect(r.error).toBe('PASSWORD_DEBIL');
    expect(r.detalle).toContain(motivo);
  });
});

describe('derivarHashPassword', () => {
  it('es determinista y depende de la sal y de la contraseña', () => {
    const a = lib.derivarHashPassword('Clave123x', 'sal1', 100, sha256Hex);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(lib.derivarHashPassword('Clave123x', 'sal1', 100, sha256Hex)).toBe(a);
    expect(lib.derivarHashPassword('Clave123x', 'sal2', 100, sha256Hex)).not.toBe(a);
    expect(lib.derivarHashPassword('Clave123y', 'sal1', 100, sha256Hex)).not.toBe(a);
  });

  it('itera de verdad: más iteraciones da otro hash, y llama al digest n veces', () => {
    let llamadas = 0;
    const contado = (s) => { llamadas++; return sha256Hex(s); };
    lib.derivarHashPassword('x1yz2345', 's', 250, contado);
    expect(llamadas).toBe(250);
    expect(lib.derivarHashPassword('x1yz2345', 's', 251, sha256Hex)).not.toBe(lib.derivarHashPassword('x1yz2345', 's', 250, sha256Hex));
  });

  it('usa el default de iteraciones si no viene', () => {
    expect(lib.derivarHashPassword('x1yz2345', 's', undefined, sha256Hex)).toBe(lib.derivarHashPassword('x1yz2345', 's', lib.PASSWORD_ITERACIONES, sha256Hex));
  });
});

describe('compararSeguro', () => {
  it('compara exacto, incluidas longitudes distintas', () => {
    expect(lib.compararSeguro('abc', 'abc')).toBe(true);
    expect(lib.compararSeguro('abc', 'abd')).toBe(false);
    expect(lib.compararSeguro('abc', 'abcd')).toBe(false);
    expect(lib.compararSeguro('', '')).toBe(true);
  });
});

describe('generarPasswordTemporal', () => {
  const hex = () => crypto.randomBytes(32).toString('hex');
  it('genera 12 caracteres sin ambiguos, que pasan la validación', () => {
    for (let i = 0; i < 200; i++) {
      const pw = lib.generarPasswordTemporal(hex());
      expect(pw).toHaveLength(12);
      expect(pw).not.toMatch(/[01OIl]/);
      expect(lib.validarPasswordNueva(pw, { usuario: 'willy', nombre: 'Willy Canaza' }).valido).toBe(true);
    }
  });
  it('exige entropía suficiente', () => {
    expect(() => lib.generarPasswordTemporal('abcd')).toThrow();
  });
});

describe('usuarioPublico', () => {
  it('quita hash, sal e iteraciones y avisa si tiene contraseña', () => {
    const u = lib.usuarioPublico({ id_usuario: 'U1', nombre: 'Jael', password_hash: 'h', password_salt: 's', password_iter: 5000 });
    expect(u).toEqual({ id_usuario: 'U1', nombre: 'Jael', tiene_password: true });
    expect(lib.usuarioPublico({ id_usuario: 'U2' }).tiene_password).toBe(false);
  });
});
