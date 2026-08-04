/**
 * Configuración de Jest — Chanchito v2.
 * Solo cubre la lógica pura de backend/lib_*.js (docs/CONTRACT.md § 1, "Regla de
 * compatibilidad Apps Script ↔ Jest"). El resto de /backend depende de SpreadsheetApp
 * y otros servicios de Google y no es testeable con Jest.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverage: false,
  collectCoverageFrom: ['backend/lib_*.js'],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    'backend/lib_validacion.js': { statements: 90, branches: 80, functions: 90, lines: 90 },
    'backend/lib_calculos.js': { statements: 90, branches: 80, functions: 90, lines: 90 },
    'backend/lib_sync.js': { statements: 90, branches: 80, functions: 90, lines: 90 },
    'backend/lib_filas.js': { statements: 90, branches: 80, functions: 90, lines: 90 }
  },
  verbose: true
};
