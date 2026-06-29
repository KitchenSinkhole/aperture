## locationPoll.ts

**Purpose:** Per-character location-poll graphile-worker task. Scheduled via `addJob` only (no cron); the handler re-enqueues itself with an adaptive delay (5s online, 60s offline).
**File:** `src/lib/jobs/tasks/locationPoll.ts`

---

### locationPoll: JobModule
- `name`: `'location-poll'`
- `cron`: **omitted** — the loop is self-perpetuating after the first enqueue from `startTrackingCharacter`.
- `run`: `withInstrumentation('location-poll', instrumentedPoll)` — `instrumentedPoll` wraps `poll` to emit exactly one `location_polls_total{outcome}` per invocation (see below), then `withInstrumentation` adds the generic `job_runs_total`/`job_duration_ms`.

### locationPollJobKey(characterId): string
Stable job key per character (`'location-poll:<id>'`). Used by both the handler's `addJob` (`jobKeyMode: 'replace'`) and `tracking.ts`'s `startTrackingCharacter` so at most one in-flight + one pending poll exists per character at any time.

### poll(payload, helpers): PollNotes
Algorithm:
0. **Payload guard** — a missing/empty payload (`!payload?.characterId`) returns `{ stopped: 'no-payload' }` immediately. A graphile-worker payload is data crossing into the handler; without this a payload-less enqueue (e.g. an operator triggering `location-poll` from the `/setup` console) would crash on `BigInt(undefined)` and burn all 25 retries. The on-demand console also excludes payload-required tasks (`onDemandJobModules()`), so this is defense-in-depth.
1. **Tracking probe** — `EXISTS (SELECT 1 FROM ap_map_character_tracking WHERE character_id = $1)`. No rows → `{ stopped: 'no-tracking' }`, exit (no re-enqueue).
2. **Character probe** — load `status`, `user_id`, the account's `main_character_id` + main name (via `ap_user` join + aliased `ap_character` self-join), `last_system_id`, `last_ship_type_id`, `last_ship_name`, `last_location_at`. Missing → `{ stopped: 'character-missing' }`. Not `active` → `{ stopped: 'character-inactive' }`. (Tracking is now purely per-map: the step-1 probe is the authoritative opt-out — when a character has no `ap_map_character_tracking` rows the loop stops there.)
3. **`getCharacterOnline`** — inside a `try/catch` covering the whole ESI phase (steps 3–6). See "Failure handling" below.
4. **Load active tracked map ids** — one query, used by both branches' broadcasts and the wormhole fold.
5. **Offline tick** — stamp `last_online = false`, re-enqueue at `LOCATION_POLL_OFFLINE_MS`, broadcast `characterUpdate(online: false, …)` on every tracked map channel using the *last-known* `lastSystemId` / `lastShipTypeId` / `lastShipName` / `lastLocationAt` from step 2. Return.
6. **Online tick** — `Promise.all([getCharacterLocation, getCharacterShip])`, persist `last_system_id` / `last_ship_type_id` / `last_ship_name` (`ship.ship_name`) / `last_online = true` / `last_location_at = now()`, re-enqueue at `LOCATION_POLL_ONLINE_MS`.
7. **Classify + fan-out** — if the previous and current system ids differ and both are non-null, call `classifyJump`, passing `arrivedDocked` derived from `location.station_id`/`location.structure_id`. On `'wormhole'`, resolve the jumping ship's mass once via `shipMass(ship.ship_type_id)`, then for each tracked map compute the **presence gate** `addNewSystems = getMapViewerUserIds(mapId).includes(character.userId)` (does the moving pilot's *account* have *this* map open in a live socket?), call `foldWormholeJumpOntoMap({ …, addNewSystems })`, and — when the fold returned a non-null `connectionId` — `logConnectionJump({ connectionId, … })` to write the per-jump mass-log. A `null` `connectionId` (the gate suppressed the jump: map closed + an endpoint off-map) skips the mass-log. Per-map outcomes (incl. the gate value) land in `notes.folds[]`. The mass-log write is a direct `pg_notify` (`connectionMassLog` task), separate from `ap_map_event`; a null mass also skips that jump's log. `'gate'` and `'teleport'` (docked arrival in k-space: pod self-destruct / podded / jump clone) are observe-only — the location is already persisted in step 6, so neither folds nor logs; `notes.jumpClass` still records which it was.

   **Why per-pilot presence.** The location-poll runs server-side regardless of whether any tab is open, so without a gate a tracked pilot day-tripping (or transiting disconnected chains) with Aperture *closed* would add every hole they pass through, polluting a map nobody is watching. The gate is the moving pilot's own account viewing that specific map; the WS viewer roster (`mapViewers.ts`) is in-process and account-keyed (`server.ts` runs the worker beside the WS server), so the lookup is a cheap in-memory `.includes`. Steps 6 (location persistence) and 8 (breadcrumb broadcast) are unaffected — a closed-Aperture pilot still moves on the roster and their location is still tracked; only *new-system creation* is gated.
8. **Broadcast** — emit `characterUpdate(online: true, systemId, shipTypeId, shipName, locationAt)` on every tracked map channel. Goes out *after* the fold so the client receives `system.added` / `connection.create` first and the breadcrumb lands on a canvas that already knows the new system.

Returns `PollNotes` with whichever subset of `{ stopped, online, previousSystemId, currentSystemId, reenqueuedInMs, jumpClass, folds }` applied. `stopped` is one of `'no-payload' | 'no-tracking' | 'character-inactive' | 'character-missing' | 'token-loss'`.

### instrumentedPoll(payload, helpers): PollNotes
Thin wrapper around `poll` that records `location_polls_total{outcome}` once per invocation (`recordLocationPoll`). The outcome is the `stopped` reason when present, else `'online'`/`'offline'` from `notes.online`. On a thrown ESI back-off (`EsiBreakerOpenError` / `EsiDowntimeError` / 401 `EsiHttpError`) it records `'esi-outage'` and re-throws; unexpected throws go uncounted (not a tracking-health signal).

### Failure handling
A single `try/catch` wraps steps 3–8:

- **`EsiTokenError`** — token-loss: `DELETE FROM ap_map_character_tracking WHERE character_id = $1`, return `{ stopped: 'token-loss' }`. The success row carries the stop reason; no re-enqueue. Re-enabling tracking later requires the user to re-authenticate and call `startTrackingCharacter` again.
- **`EsiBreakerOpenError` / `EsiDowntimeError` / `EsiHttpError` with `status === 401`** — re-enqueue at `LOCATION_POLL_OFFLINE_MS` and re-throw so `withInstrumentation` records `success = false`. The loop survives, tracking rows are kept. The 401 case reaches here only after the ESI client already force-refreshed the token and retried (see `client.md`): the refresh worked but ESI keeps rejecting the token, so it's a transient CCP-side blip — back off, don't burn graphile retries, don't delete tracking. (Contrast `EsiTokenError`, where the refresh *itself* failed → genuinely dead token → tracking deleted.)
- Other errors propagate untouched; graphile-worker handles retry per its own `max_attempts`. The boot re-arm (`runner.md`) revives a loop that ever exhausts those attempts.

### `characterUpdate` broadcast
The poll emits its breadcrumb via `pg_notify('map:<id>', envelope)` where the envelope is JSON of the form `{ task: 'characterUpdate', load: { characterId, characterName, userId, mainCharacterId, mainCharacterName, online, systemId, systemName, systemSecurity, systemTrueSec, shipTypeId, shipTypeName, shipName, locationAt } }`. `bus.ts` discriminates by the top-level `task` field — payloads without it stay on the `mapUpdate` path. The WS server forwards the resulting `ServerToClientMessage` unchanged.

`characterName`, `userId`, `mainCharacterId`, and `mainCharacterName` read from the row loaded in step 2 — the step-2 select now joins `ap_user` (for `userId`/`mainCharacterId`) and self-joins `ap_character` (aliased `main_character`) for `mainCharacterName`. The account/main fields let the roster keep grouping alts under their main across live moves (both main fields null when no main is set). `shipTypeName` is resolved per tick with one `SELECT name FROM universe_type WHERE id = $shipTypeId` lookup; null when `shipTypeId` is null or the row is missing. `systemName`/`systemSecurity`/`systemTrueSec` are resolved per tick with one `SELECT name, security, true_sec FROM universe_system WHERE id = $systemId` lookup; null when `systemId` is null or unknown to the SDE — they let the Map Info pilot roster label a pilot's location even off-map. `shipName` is the pilot's custom hull name (`ship.ship_name` on an online tick, `lastShipName` on an offline tick); null before the first online tick. All ride every broadcast so the client renders the presence-badge hover panel / pilot roster without a separate fetch.

### Notes
- **`payload.characterId` is a string** because the JSON payload of graphile-worker jobs has no `bigint`. The handler `BigInt()`s it back on entry.
- **`pathParams: { character_id: characterId }`** must be passed to every character-authed `esiCall` alongside `characterId`. The `characterId` option resolves only the bearer token; the URL path placeholder `{character_id}` is substituted separately from `pathParams`.
- The character record's `updated_at` is bumped on every tick (`set({ updatedAt: sql\`now()\` })`) so a stuck tracking row is observable from outside the job system.
- **Re-enqueue happens BEFORE the fan-out and broadcast.** If a downstream step throws, the next poll tick is already scheduled — the failure shows up in `ap_job_run.success = false` for this tick but the loop keeps going. The fold's per-step idempotency rules (`src/lib/jobs/locationCommit.md`) make the retry safe.
- **`token-loss` returns success = true.** The stop reason lands in `notes.stopped`. An operator looking at `pnpm jobs:status` sees a clean stop, not a failing job — distinct from breaker-open which IS a failure (transient).
