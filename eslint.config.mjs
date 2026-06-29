import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'dist/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  // Structured logging is mandatory (observability phase 4): all runtime logging
  // goes through `src/lib/log/logger.ts`, never `console.*`. A new `console.*`
  // call fails CI.
  { rules: { 'no-console': 'error' } },
  // Exempt the operator-facing CLI / bootstrap scripts, where console output IS
  // the UX (one-shot tools run by hand, not the long-lived server).
  {
    files: ['src/db/migrate.ts', 'src/lib/sde/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
