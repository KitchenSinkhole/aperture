## vitest.config.ts

**Purpose:** Vitest configuration — test discovery, the jsdom environment, default env vars for modules parsed at import time, and module aliases matching the app's bundler resolution.
**File:** `vitest.config.ts`

---

### default export (Vitest config)

- `test.environment: 'jsdom'`, `test.globals: true` — browser-like DOM globals available without per-file imports.
- `test.include` — `tests/**/*.test.ts` and `tests/**/*.tsx`.
- `test.globalSetup` — `./tests/globalSetup.ts`.
- `test.env` — defaults for `ESI_TOKEN_ENC_KEY`, `AUTH_EVE_CLIENT_ID`, `AUTH_EVE_CLIENT_SECRET`, `AUTH_SECRET`, `INTEGRATIONS_ENABLED` so `@/lib/env` (parsed at import time) and crypto-backed modules work without a `.env.local`; a real `.env.local` or CI env overrides each. `INTEGRATIONS_ENABLED` defaults to `'true'` so integration tests can import and call `/api/integrations/*` route handlers directly instead of always hitting the disabled-feature 404 gate.
- `resolve.alias`:
  - `@` — `./src`, matching the `@/*` path used across the app.
  - `server-only` / `client-only` — stubbed to `tests/stubs/empty.ts`, since those packages throw at import time outside Next's bundler.
  - `#bookmark-local` — resolves to `src/lib/bookmarking/local.ts` when that file exists on disk (`fs.existsSync`, checked at config-load time), and to the tracked empty slot `src/lib/bookmarking/localNone.ts` otherwise. Mirrors the same alias in `next.config.ts`'s `turbopack.resolveAlias` and `tsconfig.json`'s `paths`.
