## presence-sessions/route.ts

**Purpose:** `POST /api/integrations/presence-sessions` — machine-to-machine, token-authenticated raw presence-interval feed for external consumers building `character_session` rows.
**File:** `src/app/api/integrations/presence-sessions/route.ts`

---

### POST(request)
Body (`presenceSessionsBodySchema`, Zod): `characterIds` (1–`apertureConfig.INTEGRATION_MAX_CHARACTER_IDS` positive ints, required), `from`/`to` (optional `yyyy-mm-dd`, inclusive UTC).

Gating, in order:
- `404` when `env.INTEGRATIONS_ENABLED` is false (default) — the whole `/api/integrations/*` group is opt-in.
- `401` (with `WWW-Authenticate: Bearer`) when `resolveIntegrationToken` (`src/lib/integrations/token.ts`) can't match the `Authorization: Bearer …` header to a live `ap_integration_token` row.
- `400` on unparsable JSON or a schema violation (including a `characterIds` list over the cap).
- `400` when the resolved `[from, to]` span exceeds `apertureConfig.INTEGRATION_PRESENCE_MAX_WINDOW_DAYS` — the caller must page.
- Otherwise delegates to `loadPresenceSessions` (`src/lib/integrations/presence.ts`) scoped to the token's `corporationId`, and returns `{ generatedAt, coverage, characters }`.

**Window is always bounded**, unlike `activity-stats`: an omitted `from` defaults to `to − apertureConfig.INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS`, and an omitted `to` defaults to today (UTC). Sessions are far more numerous than daily rollup rows, so "everything" is never a valid default.

Every requested `characterId` appears in `characters` in request order (`sessions: []` for a quiet character, never omitted).

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. No `?token=` fallback (unlike `/api/metrics`) — the header is the only accepted transport, since responses carry member PII-adjacent presence.
