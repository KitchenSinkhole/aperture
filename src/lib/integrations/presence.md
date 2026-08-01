## presence.ts

**Purpose:** Per-character presence projection over `ap_character_presence`, scoped to one integration token's corporation — backs `POST /api/integrations/presence-sessions` and the `online` block merged into `/api/integrations/activity-stats`.
**File:** `src/lib/integrations/presence.ts`

---

### Types
- `IntegrationPresenceSession` — `{ startedAt, endedAt, live }`; `live` is `endedAt` newer than `PRESENCE_LIVE_GRACE_MS`.
- `IntegrationCharacterPresence` — `{ characterId, sessions }`.
- `IntegrationPresenceResponse` — `{ generatedAt, coverage: { earliest, latest }, characters }`.
- `IntegrationOnlineSummary` — `{ seconds, sessions, lastSeenAt }`, the per-bucket shape returned by `loadPresenceBuckets`.

These are re-exported from `src/types/index.ts`.

---

### loadPresenceCoverage(corporationId): Promise<{ earliest: string | null; latest: string | null }>
Min/max presence instant across the corp's data, independent of any requested characters. Used by `loadPresenceSessions` and by `loadIntegrationActivityStats` (`activityStats.ts`) to widen its rollup-day coverage with presence days.

### loadPresenceSessions({ corporationId, characterIds, from?, to? }): Promise<IntegrationPresenceResponse>
Loads every presence session **overlapping** `[from, to]` (not merely one starting inside it), scoped to `corporationId` — the same tenant boundary as `loadIntegrationActivityStats`.

- `to` defaults to today (UTC); `from` omitted means unbounded.
- Every id in `characterIds` appears in `characters`, in request order — a quiet character is `sessions: []`.
- `coverage` is the min/max presence instant across the corp's data, independent of the requested characters (mirrors the activity-stats reader's coverage convention).

### loadPresenceBuckets({ corporationId, characterIds, from?, to?, granularity }): Promise<Map<string, Map<string, IntegrationOnlineSummary>>>
Loads the same overlapping sessions clipped into `daily`/`weekly` buckets, reusing `bucketStart`/`toISODate` (`src/lib/stats/activityShaping.ts`) so day/week boundaries can't drift from the activity-stats reader.

- A session spanning a bucket boundary contributes to every bucket it touches, clipped (`GREATEST`/`LEAST`-equivalent) to that bucket's span.
- Returned as `Map<characterId.toString(), Map<bucketStartISO, IntegrationOnlineSummary>>` so callers can merge by the same keys they already group activity buckets by.
- `lastSeenAt` is the max clipped `endedAt` touching that bucket — a real instant, not a synthetic UTC-midnight placeholder.
