## zkbFeed.ts

**Purpose:** Server-side zKillboard live-feed consumer — polls the R2Z2 ephemeral feed, fans a transient `systemNotification` to every active map watching the solar system a kill happened in, and caches those kills in `universe_killmail`.
**File:** `src/lib/integrations/zkbFeed.ts`

A single long-lived loop, booted from `server.ts` (guarded by `env.ZKB_FEED_ENABLED`), **not** a graphile-worker task — it's one global feed, not per-entity work. The notification carries no map state, so (like the location-poll's `characterUpdate`) it is a direct `pg_notify` on `map:<id>` that **bypasses `ap_map_event`**; `bus.ts` discriminates on the top-level `task`. Clients pulse a red underglow under the node (`MapUnderglowBridge`).

R2Z2 model (the RedisQ replacement): walk `<base>/<seq>.json` upward from a cursor until a 404 (caught up), sleep ≥6s (`ZKB_FEED_POLL_MS`), repeat. The cursor is seeded to the feed's *current* sequence on boot — kills are surfaced live, never backfilled.

---

### startZkbFeed(): void
Starts the loop. Idempotent — a second call while running is a no-op. Resets backoff and kicks the first tick.

### stopZkbFeed(): Promise<void>
Stops the loop: clears the pending tick timer and aborts any in-flight fetch. Called from `server.ts`'s shutdown handler before `stopWorker()`.

### pollOnce(): Promise<{ processed, notified, persisted, cursor }>
One feed sweep. On the first call (cursor null) it seeds the cursor from `<base>/sequence.json` and returns without processing (live start). A failed seed (non-200, or a body that isn't `{ sequence: number }`) leaves the cursor null so the next tick re-seeds — it never falls back to 0, which would 404 on the first walk step and wedge the feed dead. Thereafter it refreshes the active-system index when stale, then fetches `cursor+1 …` until a 404 / non-200 (stops the sweep, retried next tick) or the `ZKB_FEED_MAX_CATCHUP` cap; each killmail is decoded and correlated; an on-map kill is persisted whatever its age, then notified only if fresh. `persisted` counts on-map kills written to the cache, an already-cached id included. A decoded kill whose ESI `killmail_time` is older than `ZKB_FEED_MAX_KILL_AGE_MS` — or missing/unparseable — is dropped (logged `zkb.stale_skipped`), so a reprocessed / late-submitted kill zKB appended to the live sequence never flashes; the cursor still advances past it. Exported for the loop and tests.

### loadActiveSystemIndex(): Promise<SystemIndex>
Builds the `solarSystemId → Set<mapId>` index from every `visible` system on a non-soft-deleted map (one join over `ap_map_system` × `ap_map`). Same predicate shape as the location-poll's tracked-map lookup.

### correlateKill(kill: ZkbKill, index: SystemIndex): SystemNotificationLoad[]
Pure. Returns one `systemNotification` load per active map watching the kill's `solar_system_id`; `[]` when the kill has no system or nobody is watching. The load's `killmail` carries `killmailId`, `shipTypeId` (victim hull), `totalValue` (zkb ISK), and the zKillboard `href`.

### __resetZkbFeedState(): void
Test seam — resets module singleton state (cursor, index, timers) between cases.

### Types
- `SystemIndex` — `Map<number, Set<bigint>>` (EVE solar-system id → active maps it's on).

### Behaviour & notes
- **Backoff:** a throwing tick (network/timeout, 429) never kills the loop — it backs off (`WS_RECONNECT_BASE_MS`·2^n capped at `WS_RECONNECT_MAX_MS`, floored at `ZKB_FEED_POLL_MS`) and retries. A clean tick resets backoff.
- **404 = caught up:** the cursor is not advanced past a 404, so that sequence is retried next tick.
- **Fan-out log:** every `notify` emits a `zkb.notify` info line (`kind`, `killmailId`, `systemId`, `mapId`, `href`) via `getLogger('job')`. Because the flash bypasses `ap_map_event`, this is the only durable trace of what triggered an underglow — the `systemId` flashed can be checked against the real system on `href`.
- **Operational warns** (all via `getLogger('job')`, stdout only): `zkb.tick_failed` / `zkb.rate_limited` when a poll tick throws (with attempt + retry delay), `zkb.fetch_error` on a non-200/non-404 sequence fetch, `zkb.seed_failed` (`status`) when the boot seed of `sequence.json` fails and the cursor is left null for a re-seed, and `zkb.decode_failed` when a feed entry matches no known killmail shape (drift signal).
- **Freshness guard:** a decoded kill older than `ZKB_FEED_MAX_KILL_AGE_MS` (by ESI `killmail_time`), or with a missing/unparseable time, is never notified (it is still correlated and persisted) and is logged `zkb.stale_skipped` (`killmailId`, `ageMs`; `ageMs` is null for an undatable kill). Guards against zKB placing reprocessed / late-submitted killmails into the live sequence, which a healthy forward walk would otherwise flash.
- **Persistence:** every kill that correlates to at least one active map is written to `universe_killmail` (`ON CONFLICT DO NOTHING`) before the freshness guard, so stale kills are cached but never flash. The row's body is the ESI killmail (under `esi`, under `killmail`, or the flat entry minus its `zkb` / `hash` fields) and must parse as `killmailSchema`; its hash comes from the top-level `hash` or `zkb.hash`; `total_value` is `zkb.totalValue`. A body that fails the schema, or an entry with no hash, is not persisted (`zkb.persist_skipped` info) and still flashes; a failed write logs `zkb.persist_failed` and still flashes. A kill in a system on no active map is never written.
- **Defensive decode:** accepts the R2Z2 ephemeral shape (killmail nested under `esi`, with `zkb` alongside at the top level), the flat shape (ESI fields at the top level), and the older nested `{ killmail, zkb }`; an unrecognised shape degrades to "no notification", never a crash.
- Each fetch carries `INTEGRATION_USER_AGENT` (blank UA → zKB 403) and an `INTEGRATION_REQUEST_TIMEOUT_MS` timeout combined with the loop's stop signal.

### Depends On
- `@/db/client` (`db`), `@/db/schema` (`apMap`, `apMapSystem`, `universeKillmail`), `@/lib/esi/decoders` (`killmailSchema`), `./zkb` (`zkbKillSchema`, `ZkbKill`), `@/lib/realtime/protocol` (`SystemNotificationLoad`), `@/lib/log/logger` (`getLogger`), `aperture.config` (feed cadences, base URL, UA, channel prefix), `drizzle-orm`, `zod`.
