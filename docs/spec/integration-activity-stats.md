# Integration API — Activity Stats Endpoint

**Status:** Implemented (`POST /api/integrations/activity-stats`, `POST /api/integrations/presence-sessions`). §7 `last-activity` remains unbuilt.
**Purpose:** Expose Aperture's per-character map-activity counts and presence (whether a member had Aperture open) to authorized external services over a stable, consumer-neutral HTTP contract, so another app can compute its own rollups (e.g. rank/promotion thresholds) from Aperture's activity data.
**First consumer:** Roster (EVE corp roster & activity-review app) — needs per-character "systems added" / "signatures scanned" counts over a rolling window to evaluate rank criteria, and presence intervals to populate `character_session` alongside its other sources. The contract is deliberately **not** Roster-specific; other services may consume it.

---

## 1. Namespace & versioning

All machine-to-machine, token-authenticated data feeds live under **`/api/integrations/`**, distinct from the session-authenticated UI routes (`/api/statistics`, `/api/map/...`). The name is intentionally consumer-neutral — do not name it `/api/roster/`.

- `POST /api/integrations/activity-stats` — this document.
- `POST /api/integrations/presence-sessions` — raw presence intervals (§8); backs the `online` block folded into `activity-stats`.
- `POST /api/integrations/last-activity` — companion recency feed (see §7); replaces the never-built `/api/roster/last-activity` path an early Roster adapter referenced.

No URL version segment for now (matches the rest of Aperture). The response carries a `generatedAt` and an explicit `coverage` window so consumers degrade gracefully rather than depending on an implied version.

---

## 2. Authentication & tenant scoping

Follows the pattern already used by `GET /api/metrics`: a bearer token compared in **constant time** (`node:crypto` `timingSafeEqual`), opt-in behind config. It extends that pattern in one way — the token resolves to a **corporation**, and that corporation scopes every row the request can see.

- **Token transport:** `Authorization: Bearer <token>` header. (Unlike `/api/metrics`, do **not** also accept `?token=` — these responses carry member PII-adjacent activity and should not land in URLs/logs.)
- **Token → corp resolution:** each issued token maps to exactly one `corporation_id` plus a human-readable consumer label. Storage is the implementer's choice; a `ap_integration_token` table (hashed token, `corporation_id`, `label`, `created_at`, `revoked_at`, optional `allowed_scopes`) is recommended over env JSON for rotation and per-corp auditability. Compare against the stored hash in constant time.
- **Scope enforcement:** the endpoint only ever returns activity attributed to maps of `type = 'corp'` owned by the token's corporation — the same corp scope the Statistics dialog uses (`resolveStatsAccess` → `scope = 'corp'`). A token for corp A can never observe corp B's activity. This is the load-bearing tenant boundary; treat a bug here as highest severity.
- **Opt-in:** gate the whole `/api/integrations/*` group behind an env flag (e.g. `INTEGRATIONS_ENABLED`), 404 when off, 401 on a missing/mismatched token, mirroring the metrics route.

**Responses:**
- `404` — integrations disabled.
- `401` — missing/invalid/revoked token (`WWW-Authenticate: Bearer`).
- `400` — body fails schema validation.
- `200` — success (including "no activity" — an empty `buckets` array per character, never a 404 for a quiet character).

---

## 3. Request

```
POST /api/integrations/activity-stats
Authorization: Bearer <token>
Content-Type: application/json
```

```jsonc
{
  "characterIds": [90000001, 90000002, 95000003],
  "from": "2025-08-01",        // optional ISO date (UTC); default = earliest available data
  "to":   "2026-07-17",        // optional ISO date (UTC), inclusive; default = today (UTC)
  "granularity": "weekly"      // optional; "weekly" (default) | "daily"
}
```

Schema (zod-style):

```ts
{
  characterIds: number[].min(1).max(500),   // EVE character ids (bigint-valued); bounds the response
  from?: string,   // /^\d{4}-\d{2}-\d{2}$/
  to?:   string,   // /^\d{4}-\d{2}-\d{2}$/
  granularity?: 'weekly' | 'daily'          // default 'weekly'
}
```

Notes:
- **`characterIds` is required and bounds the result.** The endpoint returns rows only for the requested characters — never "all characters seen on the corp's maps." This keeps the caller from harvesting identities it did not already know, and keeps responses bounded. Cap the list (suggest 500); `400` if exceeded so callers page.
- `from`/`to` are **inclusive UTC calendar dates**. Omitting `from` means "from the earliest data Aperture holds" (history is short — see §5).
- Weekly buckets are keyed by the **Monday of the ISO week** (UTC), matching the existing statistics reader's week math.

---

## 4. Response

```jsonc
{
  "generatedAt": "2026-07-17T12:00:00Z",
  "granularity": "weekly",
  "coverage": {
    "earliest": "2026-06-15",   // earliest day Aperture holds activity for this corp scope
    "latest":   "2026-07-13"    // latest day present in the rollup
  },
  "characters": [
    {
      "characterId": 90000001,
      "buckets": [
        {
          "bucketStart": "2026-06-15",           // Monday of ISO week (weekly) or the day (daily), UTC
          "system":     { "create": 42, "update": 6, "delete": 9 },
          "connection": { "create": 30, "update": 0, "delete": 11 },
          "signature":  { "create": 88, "update": 12, "delete": 40 },
          "online":     { "seconds": 14340, "sessions": 2, "lastSeenAt": "2026-06-15T21:03:00Z" }
        }
        // ...one bucket per period with any activity in [from, to]
      ]
    },
    {
      "characterId": 90000002,
      "buckets": []                              // requested, but no activity in range/scope
    }
  ]
}
```

Rules:
- **Every requested `characterId` appears** in `characters`, in request order. A character with no activity or presence gets `buckets: []` (not omitted, not a 404).
- **A bucket is emitted when it has any activity *or* any presence.** A member who had Aperture open but made no edits in a period is no longer dropped — the counter groups are zeroed and `online` carries the non-zero presence. Buckets with neither are still sparse (not zero-filled); the consumer fills those gaps.
- The three groups (`system`, `connection`, `signature`) each carry the `{ create, update, delete }` triplet — the same `ActivityTriplet` shape `loadActivityStats` already produces from `KIND_MAP`. Emitting all nine counters (not a single pre-picked "scans" number) is deliberate: which counter means "scanned" is a **consumer-side** decision (§6), and other consumers may want different counters, without a wire-format change.
- `online` is `{ seconds, sessions, lastSeenAt }`: `seconds` is presence time clipped to the bucket, `sessions` is the number of presence sessions touching the bucket, `lastSeenAt` is the latest clipped `ended_at` in that bucket (a real instant) or `null` when there was no presence. See §8 for the underlying semantics.
- `coverage` reflects the token's corp scope, not global Aperture data, and spans both rollup-day coverage and presence coverage (whichever is wider). It exists so a consumer computing a "rolling 12 months" window can tell that the underlying history only spans a few weeks and label its output as partial rather than reporting a misleadingly low total.

---

## 5. Data source & derivation

Backed by the existing **`ap_activity_rollup`** materialized view (daily grain, one row per `(day, character_id, map_id, kind)` with `event_count`). This is the same source `GET /api/statistics` reads, so no new ingestion is required — the endpoint is a **service-auth, per-character projection** of logic that already exists in `src/lib/stats/activity.ts`.

Two deliberate differences from `loadActivityStats`:

1. **No main-character attribution.** `loadActivityStats` collapses to Aperture's mains via `COALESCE(main_character_id, character.id, rollup.character_id)`. This endpoint must return **raw acting `character_id`** counts and must **not** collapse alts. Consumers own their own identity/alt graph (Roster mirrors it from Alliance Auth, which may disagree with Aperture's `ap_user` grouping) and roll up themselves. Returning main-collapsed numbers would double-attribute or mis-attribute on the consumer side.
2. **Caller-defined window & granularity**, not 12 trailing fixed buckets. Bucket the daily rollup into weekly (Monday, UTC) or daily periods across `[from, to]` with `date_trunc`/ISO-week math.

Shared with `loadActivityStats` (keep consistent):
- Corp-scope map resolution (`type = 'corp'` for the token's corporation, `deleted_at IS NULL`).
- The `KIND_MAP` grouping of the nine `system` / `connection` / `signature` event kinds into `[group, action]`.
- Exclusion of non-contributions: `kind NOT LIKE 'map.%'` and the derived `system.moved` re-bucketing of drag-only position updates (a `system.moved` is **not** activity — it must not inflate `system.update`).
- All date math in **UTC**.

---

## 6. Metric semantics (informative — for consumers)

The endpoint returns raw counters; it does not define "scanned." Mapping counters to a corp's own criteria is the consumer's job. For reference, the counters correspond to Aperture map events:

| Counter | Meaning |
|---|---|
| `system.create` | A system was **added to the map** (the corp discovered/recorded it). |
| `system.update` | A recorded system's data was edited (excludes drag-only moves). |
| `system.delete` | A system was removed from the map. |
| `connection.create` / `update` / `delete` | A wormhole/gate connection was added / edited / removed. |
| `signature.create` | A **signature was scanned / recorded** on a system. |
| `signature.update` / `delete` | A signature was edited / removed. |

The first consuming corp (via Roster) counts **`system.create`** as its "systems scanned in the annual statistics" figure (systems added to the map). Roster also exposes **`signature.create`** as an alternative "signatures scanned" metric so a different corp can choose that instead. Both are present in every response; no endpoint change is needed to switch.

---

## 7. Companion endpoint — `last-activity` (recency)

Same namespace, same auth/scoping model, separate concern: `POST /api/integrations/last-activity` returns a **last-seen timestamp** per requested character (max of last map-location and last map-event time), for consumers driving idle/activity checks rather than cumulative counts.

```jsonc
// Request:  { "characterIds": [90000001, 90000002] }
// Response: { "characters": [ { "characterId": 90000001, "lastSeenAt": "2026-07-16T20:11:00Z" },
//                             { "characterId": 90000002, "lastSeenAt": null } ] }
```

Kept as a distinct endpoint (not folded into `activity-stats`) because recency and cumulative counts have different shapes, cache characteristics, and consumers. Specify fully before building; listed here so the namespace is designed as a set.

---

## 8. Presence

Aperture also tracks whether a member had the app open at all, independent of what they edited, and exposes it two ways: folded into `activity-stats` as the `online` block (§4), and as raw intervals via `POST /api/integrations/presence-sessions`.

**Source.** "Online in Aperture" means an authenticated WebSocket is connected — the app is open in a browser tab. It is not EVE-onlineness; the ESI online probe used by location tracking is a separate signal and is not consulted here. A backgrounded/minimised tab still counts, since the socket stays open.

**Storage.** Sessions live in `ap_character_presence` (`character_id`, a `corporation_id` snapshot, `started_at`, `ended_at`), one row per unbroken presence interval. `ended_at` is advanced by the WS heartbeat (~30s) and on close; there is no separate "last seen" column and no dangling-session sweeper — a crashed process simply leaves `ended_at` at its last heartbeat.

**Stitching.** A reconnect within `PRESENCE_SESSION_GAP_MS` (5 minutes) of the previous `ended_at` adopts the existing open row instead of opening a new one, so intervals for one character never overlap and a short network blip or SharedWorker restart doesn't shred an evening into many sessions. This means presence can over-count a genuine short absence by up to the gap window — a deliberate trade.

**`live`.** A session is `live: true` when its `ended_at` is newer than `PRESENCE_LIVE_GRACE_MS` (1 minute, twice the heartbeat interval) ago.

**Bounded window on `presence-sessions`.** Unlike `activity-stats`, this endpoint always bounds `[from, to]`: an omitted `from` defaults to `to − INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS` (90 days), and a span wider than `INTEGRATION_PRESENCE_MAX_WINDOW_DAYS` (366 days) is a `400` telling the caller to page. Session rows are far more numerous than daily rollup rows, so "everything" is not a safe default here.

**Tenant boundary.** `ap_character_presence.corporation_id` is a **snapshot** of the character's corporation taken when the session opened, not a live join — the same corp-scoping principle as §2, applied so a corp's token can never see a pilot's presence from before they joined that corp. A null-corp row (the character had no corp at session-open) is invisible to every token.

**Retention.** Presence rows older than `PRESENCE_RETENTION_DAYS` (400 days) are pruned by the existing `character-cleanup` job.

**No backfill.** Presence accrues forward only from deploy. A consumer should treat pre-deploy buckets/coverage as unknown, not as zero.

### `POST /api/integrations/presence-sessions`

Same auth/scoping model as §2 (`INTEGRATIONS_ENABLED` → 404, bad/missing token → 401, bad body → 400).

```jsonc
// request
{ "characterIds": [90000001], "from": "2026-05-01", "to": "2026-07-31" }

// response
{ "generatedAt": "2026-08-01T12:00:00.000Z",
  "coverage": { "earliest": "2026-06-15", "latest": "2026-07-31" },
  "characters": [ { "characterId": 90000001, "sessions": [
      { "startedAt": "2026-07-27T18:02:00.000Z",
        "endedAt":   "2026-07-27T21:44:11.000Z",
        "live": false } ] } ] }
```

Every session **overlapping** `[from, to]` is returned (not merely one starting inside it), per character in request order; a quiet character gets `sessions: []`. `coverage` is the min/max presence instant across the token's corp scope. A likely consumer mapping onto a `character_session`-shaped table: `logonAt = startedAt`, `lastConfirmedAt = endedAt`, `logoffAt = live ? null : endedAt`.

---

## 9. Implementation checklist

- [x] `INTEGRATIONS_ENABLED` env flag; `/api/integrations/*` returns 404 when unset.
- [x] Token store resolving `token → { corporationId, label }` (hashed, revocable), constant-time compare.
- [x] `POST /api/integrations/activity-stats` route: zod-validate body, resolve corp from token, query `ap_activity_rollup` scoped to that corp's `type='corp'` maps, bucket per `granularity`, return per raw `character_id`.
- [x] Reuse `KIND_MAP` grouping and the `system.moved` / `map.%` exclusions from `src/lib/stats/activity.ts`; factor the shared shaping so the two readers can't drift.
- [x] `coverage` computed from min/max `day` in scope (and, since presence, widened to presence coverage too).
- [x] Cap `characterIds` (≈500); 400 on overflow.
- [x] Instrument with `withApiMetrics('/api/integrations/activity-stats', ...)` like the other routes.
- [x] Add companion `route.md` per the repo's companion-doc convention.
- [x] `ap_character_presence` write path from the WS socket lifecycle (open/heartbeat/close), stitched, corp-snapshotted.
- [x] `POST /api/integrations/presence-sessions` route with a bounded, pageable window.
- [x] `online` block merged into `activity-stats`; a bucket is emitted on activity or presence.
- [x] Presence retention pruning in `character-cleanup`.
- [ ] `POST /api/integrations/last-activity` (§7) — not built.

## 10. Open decisions for the implementer

1. **Token storage** — DB table (recommended) vs env JSON map. Affects rotation/audit only; the wire contract is unchanged either way.
2. **Cross-scope activity** — this spec scopes strictly to `type='corp'` maps of the token's corp (matching the Statistics dialog). If a corp also wants scanning done on members' *private* maps to count, that is a scope-model change; leave it out of v1.
3. **Rate limiting / caching** — the underlying MV refreshes on a schedule, so responses can carry a short `Cache-Control` and/or the endpoint can rate-limit per token. Not required for correctness; decide based on consumer poll frequency.
