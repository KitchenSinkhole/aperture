## activityStats.ts

**Purpose:** Per-character activity projection over `ap_activity_rollup`, merged with `ap_character_presence` (`presence.ts`), scoped to one integration token's corporation — backs `POST /api/integrations/activity-stats`.
**File:** `src/lib/integrations/activityStats.ts`

---

### Types
- `IntegrationActivityBucket` — `{ bucketStart, system, connection, signature, online }`; the three edit groups are `ActivityTriplet` (`src/lib/stats/activityShaping.ts`), `online` is `IntegrationOnlineSummary` (`presence.ts`).
- `IntegrationCharacterActivity` — `{ characterId, buckets }`.
- `IntegrationActivityStatsResponse` — `{ generatedAt, granularity, coverage: { earliest, latest }, characters }`.

These are re-exported from `src/types/index.ts`.

---

### loadIntegrationActivityStats({ corporationId, characterIds, from?, to?, granularity }): Promise<IntegrationActivityStatsResponse>
Loads activity for `characterIds`, scoped strictly to `corporationId`'s `type='corp'`, non-deleted maps — the tenant boundary a token can never see past — merged with `loadPresenceBuckets` (`presence.ts`) over the same window/granularity, scoped by the same `corporationId`.

- **Raw `character_id`, not main-collapsed** — unlike `loadActivityStats`, does not join `ap_character`/`ap_user` or attribute to an account main; consumers own their own alt-identity graph.
- **Caller-defined window** — `to` defaults to today (UTC); `from` omitted means unbounded (from the earliest rollup/presence data). Both are inclusive.
- Buckets by `weekly` (Monday of the ISO week, UTC) or `daily` period via the shared `bucketStart`/`KIND_MAP`/`activityKindExclusion` (`src/lib/stats/activityShaping.ts`) — same `map.%`/`system.moved` exclusions as the UI reader.
- **A bucket is emitted when it has any activity or any presence** — a character with presence but zero edits still surfaces, with zeroed edit triplets and a populated `online`. A bucket with edits but no presence carries `online: { seconds: 0, sessions: 0, lastSeenAt: null }`. Emitted buckets are sorted oldest → newest.
- `coverage` is the union of the corp's rollup-day span (in-scope maps only) and its presence-instant span (`loadPresenceCoverage`) — earliest/latest across both.
- Every id in `characterIds` appears in `characters`, in request order — a quiet character is `buckets: []`, never omitted. A corp with no `type='corp'` maps in scope still gets presence-only buckets if it has presence data.
