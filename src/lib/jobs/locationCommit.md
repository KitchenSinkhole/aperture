## locationCommit.ts

**Purpose:** Per-map fold for the location-poll. Turns "character moved from system A to system B (wormhole)" into the same set of events a user-driven `addSystem(A) + addSystem(B) + createConnection(A→B)` would produce, minus the redundant ones.
**File:** `src/lib/jobs/locationCommit.ts`

---

### foldWormholeJumpOntoMap({ mapId, characterId, fromSystemId, toSystemId, addNewSystems }): FoldResult
Runs three steps in sequence, each its own `commitMapEvent` transaction:

1. **`ensureSystemVisible(from)`** — if a `(map_id, system_id)` row already exists with `visible = true`, skip (no event). Otherwise upsert visible=true and emit `system.added` carrying the full node body via `buildSystemNode`. Both a fresh insert and a re-add of a hidden row get a freshly computed open slot (see Placement); only alias/tag/status/intel are preserved across the re-add.
2. **`ensureSystemVisible(to, { anchorSystemId: fromSystemId })`** — same as #1, but a fresh insert is anchored on the `from` system so the destination fans off the parent's real position instead of landing at (0,0).
3. **`ensureConnection(fromMapSystemId, toMapSystemId)`** — if a *confirmed* connection already links the two endpoints in *either* direction, reuse it (no event, `created: false`). If a **dormant** one exists (`confirmed_at IS NULL` — an endpoint was removed and the link hasn't been restored via the sig path), re-confirm it (`confirmed_at = now()`) and re-broadcast the full edge body as `connection.create` (`created: true`); the row keeps its observed WH state and is never deleted/recreated, mirroring `restoreConnection`. Otherwise insert a new `scope='wh'`, `mass_status='fresh'`, `jump_mass_class=null` connection and emit `connection.create` with the full edge body. Returns `{ connectionId, created }` either way (the id feeds the mass-log; a self-loop throws — see Notes).
4. **`tagOnJump`** (auto-tagging) — calls `assignTagOnConnect`; on a `0121` map the destination is rooted as a child of the `from` system and the assigned tag is emitted as a separate `system.updated` event. No-op for ABC (tagged at add, in `ensureSystemVisible` via `assignTagOnAdd`) and unscheme'd maps. Best-effort: a tagging failure is logged and never fails the jump fold.

**`addNewSystems` gate (presence-aware add).** `addNewSystems` is `true` only when the moving pilot's account currently has *this* map open in a live WebSocket — the caller (`locationPoll.ts`) resolves it from `getMapViewerUserIds(mapId)`. When **`false`** the fold takes a short path that *never makes a non-visible system visible*: it resolves both endpoints via `visibleMapSystemId`, and if **either** isn't already visible on the map it returns immediately having done nothing (`connectionId: null`). If **both** are already visible it runs only steps 3–4 (`ensureConnection` + `tagOnJump`) — recording a connection/movement between known systems. This keeps a pilot day-tripping with Aperture closed (or transiting disconnected chains) from polluting a dormant map with every hole they pass through, while still tracking their movement among already-added systems.

Returns `{ mapId, fromSystemAdded, toSystemAdded, connectionCreated, connectionId }`. The booleans surface in `ap_job_run.notes` so the operability sweep can tell "the poll detected jumps and they were fully novel" from "the poll detected jumps but everything was already on the map". `connectionId` is the traversed connection (created *or* pre-existing) and is consumed by the caller (`locationPoll.ts`) to write the per-jump mass-log (`src/lib/map/connectionMassLog.ts`); it is **`null`** when the jump was suppressed by the `addNewSystems` gate (map closed + an endpoint off-map), in which case the caller skips the mass-log.

### visibleMapSystemId(mapId, systemId): bigint | null
Internal helper used by the `addNewSystems = false` path. Returns the `ap_map_system.id` for a system that is already on the map with `visible = true`, or `null` if it isn't placed/visible. Read-only — never inserts.

### Idempotency rules
- **`system.added` suppressed** when the row is already visible. A re-add by a manual click in the UI between poll ticks is a separate event from the poll's perspective. A re-add of a *hidden* row does emit `system.added` and re-places the node (its old coordinates belong to a now-defunct chain).
- **`connection.create` suppressed** when a *confirmed* A↔B link already exists in either direction. Mass/EOL/rolling state on the existing connection is left untouched — the poll observes movement, it doesn't reset operator state. A **dormant** A↔B link (`confirmed_at IS NULL`) is the exception: traversing it re-confirms and re-broadcasts it as `connection.create` (the observed WH state is preserved, only `confirmed_at` flips), so a hole that went dormant when an endpoint was removed reappears when a tracked pilot jumps it again.
- **Whole-jump suppressed** when `addNewSystems = false` and either endpoint isn't already visible — no system, connection, tag, or mass-log is written for that jump on that map.

### Placement (location-conscious)
- `ensureSystemVisible` takes an optional `{ anchorSystemId?: number }`. Both a **fresh** insert and a **hidden re-add** compute a slot via `computePlacement` and write it on both the insert and the `onConflictDoUpdate` `set` clause, so a previously-hidden system is re-placed off its new parent rather than reappearing at its stale coordinates from a prior chain. Alias/tag/status/intel are still preserved across the re-add.
- `computePlacement(mapId, anchorSystemId?)` reads all visible systems' `{positionX, positionY}` as the occupied set, picks an anchor (the `anchorSystemId` row's position if visible → else the centroid of visible systems → else origin), and returns `findOpenPosition(anchor, occupied)` from `@/lib/map/placement` — a grid-aligned point that overlaps no existing node.
- The fold anchors the **to** system on the **from** system; the **from** system itself is placed unanchored (centroid/origin).

### Failure semantics
Each step is its own transaction. A failure between steps leaves a consistent state and the next poll tick (5s later on the online cadence) skips the parts that succeeded and retries the parts that didn't. There is no compensation logic.

### Notes
- Self-loop guard (`sourceMapSystemId === targetMapSystemId`) in `ensureConnection` throws with a clear message — the schema's `ap_map_connection_no_self_loop` CHECK would throw anyway, and `ensureConnection` must return a real `connectionId`, so a self-loop can't be silently skipped. Unreachable in practice: the poll only folds when `from != to` system, which yields distinct map-system rows.
- Imports `commitMapEvent` from `src/lib/map/mutations/core.ts` (no `'server-only'` — see that file's `.md` for the precedent). Imports `buildSystemNode` from `src/lib/map/systemNode.ts`.
- This module is the only place in the location-poll path that writes to `ap_map_*` tables; the poll handler itself is observation-only and delegates here for fan-out.
- The best-effort auto-tag failure in `tagOnJump` is logged via the structured logger ([[logger]], `source='job'`) at `warn` (stdout only, not persisted).
