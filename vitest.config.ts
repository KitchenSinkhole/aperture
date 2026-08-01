import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globalSetup: ['./tests/globalSetup.ts'],
    // Defaults so `@/lib/env` (parsed at import time) and crypto work in tests.
    // A real `.env.local`/CI env overrides these via process.env.
    env: {
      ESI_TOKEN_ENC_KEY:
        process.env.ESI_TOKEN_ENC_KEY ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      AUTH_EVE_CLIENT_ID: process.env.AUTH_EVE_CLIENT_ID ?? 'test-client-id',
      AUTH_EVE_CLIENT_SECRET: process.env.AUTH_EVE_CLIENT_SECRET ?? 'test-client-secret',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-auth-secret',
      // Lets integration tests import and call `/api/integrations/*` route
      // handlers directly instead of always getting the 404 gate.
      INTEGRATIONS_ENABLED: process.env.INTEGRATIONS_ENABLED ?? 'true',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only`/`client-only` throw at import outside Next's bundler;
      // stub them so server modules can be unit-tested.
      'server-only': fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url)),
      'client-only': fileURLToPath(new URL('./tests/stubs/empty.ts', import.meta.url)),
    },
  },
});
