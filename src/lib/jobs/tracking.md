## tracking.ts

**Purpose:** Lifecycle seam for the location-poll. `startTrackingCharacter` opts a character in (inserts the join row + enqueues the first poll); `stopTrackingCharacter` opts them out (deletes the row; the next handler tick exits cleanly).
**File:** `src/lib/jobs/tracking.ts`

---

### startTrackingCharacter({ mapId, characterId }): StartTrackingResult
1. Probe `ap_map` for the map's existence and `deleted_at IS NULL`. Returns `{ ok: false, error: 'map-missing' | 'map-soft-deleted' }` on either failure.
2. `INSERT … ON CONFLICT DO NOTHING` into `ap_map_character_tracking`. Result tells us whether the row already existed (`alreadyTracked: true`).
3. `SELECT graphile_worker.add_job('location-poll', …, job_key_mode => 'preserve_run_at')` — if a poll is already scheduled for this character (e.g. from a prior `start` on a different map), keep its existing run-at; if no job exists, this inserts a new one at `run_at = now()`.

Returns `{ ok: true, alreadyTracked }`.

### stopTrackingCharacter({ mapId, characterId }): { removed }
`DELETE` the tracking row. Does NOT cancel the in-flight poll job — the handler checks tracking-row count on entry and exits with `{ stopped: 'no-tracking' }` on the tick after the last row goes away. Avoiding an external cancel keeps the lifecycle race-free.

### pruneTrackingForLostAccess(characterId): Promise<{ prunedMapIds }>
Drop a character's tracking on every **live** map they can no longer view, and broadcast a `characterLogout` on each so live rosters forget them. Called from the `character-cleanup` affiliation sweep after a pilot's corp/alliance change is detected and `syncCharacterAuthz` has refreshed the cached affiliation: for each tracked map, `canViewMap(characterId, mapId)` is re-evaluated; a `false` result deletes the `(map, character)` row and fires `broadcastCharacterLogout`. Maps the pilot can still view (own private maps, a corp they stayed in) are untouched. The location-poll self-exits on its next tick once no tracking rows remain. Returns the pruned map ids.

### seedTrackingForGainedAccess(characterId): Promise<{ seededMapIds }>
Mirror of `pruneTrackingForLostAccess`. When a character **gains** access — re-joins a corp, moves into a new corp/alliance with map access, or is freshly added as an alt onto an account that has already auto-seeded maps — add a tracking row on every **live** map where: the character's account already has an `ap_map_tracking_seed` marker (the account opted that map into auto-tracking on first open), the character has no tracking row yet for that map (SQL anti-join), and `canViewMap(characterId, mapId)` is true. Each newly-tracked map enqueues the poll (`preserve_run_at`). No explicit broadcast — the location-poll's next tick re-adds the pilot to live rosters, symmetric with `seedTrackingForMap`/`startTrackingCharacter`. A non-`active` character (kicked/banned) is skipped. Idempotent. Called from the sign-in JWT callback (`src/lib/auth.ts`, immediate re-track on re-login / add-alt, after `syncCharacterAuthz`) and the `character-cleanup` affiliation sweep (re-track on corp re-join without a fresh login, bounded by the cron tick). Returns the map ids a row was added on.

Gating on the seed marker keeps it account-centric: a re-joining/new character is auto-tracked only on maps the account already auto-tracks, never on maps the account has never opened (those seed when the account next opens them, via `seedTrackingForMap`).

**Trade-off vs. the "empty selection survives" invariant.** That invariant belongs to `seedTrackingForMap` and is about **map re-open** — it still holds (this function doesn't touch the marker). But this function fires on a different event — a per-character **access gain** (full SSO login / corp change) — and there is no stored signal that distinguishes "row absent because the user deselected this character while it kept access" from "row absent because access was pruned and is now regained". So a character the account previously deselected on a seeded map it can still view **is re-tracked on the next full login**. This is the deliberate cost of guaranteeing the reported requirement: a re-joining pilot whose tracking was pruned, then logs in (which freshens the affiliation cache so the cron sweep sees no change and won't re-track it), must still come back tracked. Per-character deselection that must survive a re-login is not supported.

### seedTrackingForMap({ mapId, userId }): Promise<void>
The per-map default: the first time an account opens a map, auto-track all its **active** characters. In one transaction: `INSERT … ON CONFLICT DO NOTHING` the `ap_map_tracking_seed` marker; if it was freshly inserted, select the account's `status='active'` characters, upsert a `(mapId, characterId)` row per character, and enqueue each poll with `preserve_run_at`. If the marker already existed, returns without touching the join table — so a deliberately-empty per-map selection survives and is never re-seeded. The marker gate makes the auto-add fire exactly once per `(map, account)`. Caller guarantees the map is viewable/live (realtime-subscribe seam, downstream of `canViewMap`).

### Notes
- **`graphile_worker.add_job` via raw SQL.** No `WorkerUtils` instance held by this module; tracking enable/disable is rare enough that the per-call overhead is irrelevant. Keeps the module dependency-light so it can be imported from Server Actions, API routes, admin tools, etc.
- **`preserve_run_at` semantics in graphile-worker:** if a row with the given `job_key` exists, all attributes EXCEPT `run_at` are updated; if no row exists, this acts as a normal insert. Exactly the semantic we want for "start tracking shouldn't ever bump the clock of an already-running poll".
- **Authz:** any character with access to a non-soft-deleted map can opt themselves in. Access is *revoked* the other way by `pruneTrackingForLostAccess` (`canViewMap` re-check + `characterLogout`).

### Depends On
- `@/lib/auth/rights` (`canViewMap`) — the view-access re-check in `pruneTrackingForLostAccess`.
- `@/lib/realtime/characterLogout` (`broadcastCharacterLogout`) — roster eviction on prune.
- `@/lib/log/logger` (`getLogger('job')`) — the start-tracking info line.
