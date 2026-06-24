## restoreConnection.ts

**Purpose:** Restore a dormant wormhole connection (Stage 4 sig-memory restore) — re-confirm the connection and re-activate any hidden endpoint, under one transaction, returning the committed events for a bulk fold.
**File:** `src/lib/map/mutations/restoreConnection.ts`

---

### restoreConnection(input: RestoreConnectionInput): Promise<ActionResult<RestoreConnectionResult>>
A `wh` connection goes **dormant** (`confirmed_at = NULL`, hidden from `loadMapForView`) when one of its endpoints is removed (`removeSystem`, Stage 3), but the row keeps its full observed WH state (type/mass/EOL/static) and the surviving `ap_map_signature` still points at it. When a paste re-confirms that sig, the client offers to restore. This orchestrator, under one outer `db.transaction` (mirroring `addSystemWithStargateLinks` / `deleteSubchain`):

1. Loads the connection by `(connectionId, mapId)`; throws `"Connection not found."` if missing and `"Only wormhole connections can be restored."` if `scope !== 'wh'` (structural links never go dormant).
2. Re-activates any **hidden** endpoint via `addSystem({ systemId, tx })` (resolving the EVE `system_id` from the endpoint's `ap_map_system` row). Idempotent for an already-visible endpoint; re-add keeps the prior position and (via Stage 1) re-hydrates that system's surviving sigs. Pushes each `system.added` payload.
3. Re-confirms the connection via `commitMapEvent({ kind: 'connection.create', tx, mutate })`, where `mutate` runs `UPDATE ap_map_connection SET confirmed_at = now() … RETURNING <edge body>` and returns the full edge body (mirrors `createConnection`'s shape). Pushes the `connection.create` payload.

Returns the ordered `MapEventPayload[]` (`system.added`(s) first so the far node exists before the edge folds, then `connection.create`) as `{ ok, data: { payloads }, eventId: 0 }` — the same bulk contract the paste/subchain paths use. We never delete/recreate the row (that would cascade the sig and lose observed state); restore is a `confirmed_at` flip + re-broadcast.

Re-uses `connection.create` rather than a new event kind — the client `applyEvent` reducer upserts edges by id, so re-broadcasting an existing edge is idempotent. Runs in joined-tx mode throughout, so per-commit webhook enqueue is skipped and nothing is enqueued afterward: a restore is structural memory (like an auto gate-link) and intentionally does not notify.

**Parameters:**
- `input.mapId` — `ap_map.id`.
- `input.connectionId` — `ap_map_connection.id` of the dormant row to restore.
- `input.characterId` — audit FK; null when the actor was erased.

**Returns:** `ActionResult<{ payloads }>`; the wrapper-level `eventId` is always `0`.

### type RestoreConnectionInput / RestoreConnectionResult
Input bag (`mapId`, `connectionId`, `characterId`) and result (`{ payloads }`).

### Depends On
- `addSystem` (`./systems`) — re-activates a hidden endpoint, joined to the outer tx.
- `commitMapEvent` (`./core`) — the single commit primitive (joined-tx mode).
- `apMapConnection`, `apMapSystem` (Drizzle schema).
