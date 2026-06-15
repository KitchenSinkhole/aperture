## env.ts

**Purpose:** Zod-validated `process.env` reader. The one place env vars become typed values. Import `env` instead of touching `process.env` directly anywhere else in the app.
**File:** `src/lib/env.ts`

---

### env
A frozen object built from `schema.parse(process.env)` at import time. Throws (loudly) on first import if a required var is missing or malformed — boundary validation, "validate only at system boundaries".

Fields:
- `DATABASE_URL` — required, defaulted to the local compose connection string.
- `AUTH_SECRET`, `AUTH_EVE_CLIENT_ID`, `AUTH_EVE_CLIENT_SECRET`, `ESI_TOKEN_ENC_KEY` — **required in production** (enforced by a `superRefine` that only fires when `NODE_ENV === 'production'`), optional elsewhere so a fresh clone can `pnpm dev`, migrate, and test without `.env.local`. No dotenv loader exists in the repo; `next dev` injects `.env.local` and `tsx` scripts inherit the shell env.
- `AUTH_EVE_SSO_BASE` — EVE SSO base URL; defaulted to `https://login.eveonline.com` (point at `https://sisilogin.testeveonline.com` for SISI).
- `ESI_BASE_URL` — ESI base URL; defaulted to `https://esi.evetech.net`. Used by the ESI client to build request URLs.
- `EVE_USER_AGENT` — required by the ESI client; defaulted.
- `ZKB_FEED_ENABLED` — master switch for the server-side zKillboard live feed (`zkbFeed.ts`). String `'true'`/`'false'`, parsed to a boolean; defaults to `true`. Set `'false'` to disable the outbound feed (CI, air-gapped dev, zKB degraded). Only `server.ts` reads it (the only place the feed is booted).
- `FAVICON_URL` — URL or `/public`-relative path for the browser tab icon, used in `layout.tsx` metadata. Defaults to `/favicon.png`. Operators set this to a custom hosted URL or drop a file in `public/` to bundle it.
- `NODE_ENV` — narrowed to `development | test | production`.

### Env
Inferred type alias for the parsed shape.
