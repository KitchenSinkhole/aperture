## activity-stats/route.ts

**Purpose:** `POST /api/integrations/activity-stats` — machine-to-machine, token-authenticated per-character map-activity feed for external consumers.
**File:** `src/app/api/integrations/activity-stats/route.ts`

---

### POST(request)
Body (`activityStatsBodySchema`, Zod): `characterIds` (1–`apertureConfig.INTEGRATION_MAX_CHARACTER_IDS` positive ints, required), `from`/`to` (optional `yyyy-mm-dd`, inclusive UTC), `granularity` ∈ `weekly|daily` (default `weekly`).

Gating, in order:
- `404` when `env.INTEGRATIONS_ENABLED` is false (default) — the whole `/api/integrations/*` group is opt-in.
- `401` (with `WWW-Authenticate: Bearer`) when `resolveIntegrationToken` (`src/lib/integrations/token.ts`) can't match the `Authorization: Bearer …` header to a live `ap_integration_token` row.
- `400` on unparsable JSON or a schema violation (including a `characterIds` list over the cap).
- Otherwise delegates to `loadIntegrationActivityStats` (`src/lib/integrations/activityStats.ts`) scoped to the token's `corporationId`, and returns `{ generatedAt, granularity, coverage, characters }`.

Every requested `characterId` appears in `characters` in request order (`buckets: []` for a quiet character, never omitted). Activity is raw per-character — not collapsed to an account main — and scoped strictly to the token's corp's `type='corp'` maps.

Each bucket carries an `online: { seconds, sessions, lastSeenAt }` block merged in from `ap_character_presence` — a bucket is emitted on activity **or** presence, so a member with the app open but no edits still surfaces (zeroed edit triplets, populated `online`). `coverage` spans both the rollup-day range and the presence range.

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. No `?token=` fallback (unlike `/api/metrics`) — the header is the only accepted transport, since responses carry member PII-adjacent activity.
