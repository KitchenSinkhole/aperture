## systems.ts

**Purpose:** System-level map mutations (add / remove / update), each a single `commitMapEvent` call that lands one `ap_map_event` row and one realtime broadcast.
**File:** `src/lib/map/mutations/systems.ts`

---

### addSystem(input: AddSystemInput): Promise<ActionResult<MapEventPayload>>
Adds a solar system to a map. Inserts a new `visible = true` `ap_map_system` row, or — via the `(map_id, system_id)` unique index — flips a previously-removed row back to visible while leaving its alias/tag/status/intel intact (CLAUDE.md lifecycle rule: systems are never hard-deleted). Position is set only when provided (re-add keeps the prior position otherwise). On auto-tagging maps it calls `assignTagOnAdd` inside the same transaction (before re-reading the node) so an ABC tag rides in the payload and a re-add recomputes rather than preserving a stale tag. Re-reads the placed row joined to its universe metadata + statics and emits `system.added` with the full node body.

**Parameters:**
- `input.mapId` — `ap_map.id`.
- `input.systemId` — EVE solar-system id (`universe_system.id`).
- `input.characterId` — audit FK; null when the actor was erased.
- `input.positionX` / `input.positionY` — optional canvas coordinates.
- `input.tx` — optional outer transaction to join (used by `addSystemWithStargateLinks`); when passed, failures throw instead of returning `{ ok: false }`.

**Returns:** `ActionResult<MapEventPayload>` with a `system.added` payload.

---

### addSystemWithStargateLinks(input: AddSystemInput): Promise<ActionResult<AddSystemResult>>
Add a system and auto-link it to every visible system already on the map that shares an in-game stargate with it (`universe_stargate_edge`). Runs `addSystem` plus each `createConnection` (scope `stargate`) under one `db.transaction`, so the add and all gate links commit atomically and the per-row `tg_map_event_notify` triggers fire after commit. Returns the ordered `MapEventPayload[]` (the `system.added` event first, then each `connection.create`) so the client folds them like a bulk paste. K-space / Pochven systems pick up gate links; wormhole systems have no stargate edges and so add with zero extra events. A re-added system that already carries `stargate` links to a neighbour is not duplicated (a soft-removed system keeps its connection rows). This is the orchestrator the `POST /api/map/[mapId]/systems` route calls; the other `addSystem` callers (location-poll fold, signature paste, import, Thera) use `addSystem` directly and are unaffected.

Webhook fanout: the joined transaction skips the per-commit webhook enqueue (like every bulk path), so after commit this explicitly `enqueueWebhookDispatch`es **only** the `system.added` event — preserving the standalone-add notification. The auto gate links are structural and intentionally don't notify (they'd be noise).

**Returns:** `ActionResult<AddSystemResult>` (`{ payloads }`); the wrapper-level `eventId` is always `0`.

---

### removeSystem(input: RemoveSystemInput): Promise<ActionResult<MapEventPayload>>
Flips `visible = false` (and stamps `last_visible_at`) on the `ap_map_system` row matching `(mapSystemId, mapId)`. The row persists. **Locked guard:** throws (rolls back) if the target system has `locked = true` — a full block forcing a mindful unlock before deletion (issue #157). This is the single chokepoint every delete path routes through (single, group, subchain, disconnected), so a locked system anywhere in a subchain rolls the entire batch back. **Home guard:** throws (rolls back) if the target system is the map's `home_map_system_id` — the Home node can't be removed while designated. Throws if no matching row. **Dormants incident wormhole connections:** in the same transaction, sets `confirmed_at = NULL` on every `scope='wh'` connection touching this system (source or target) — they become dormant memory (kept for an in-place restore once the sig is re-pasted; hidden from `loadMapForView` via its `confirmed_at IS NOT NULL` filter). The single `system.removed` broadcast already prunes incident connections on every client regardless of scope, so live + reload agree. Non-`wh` (stargate/jumpbridge/abyssal) links are left confirmed and re-link structurally via `addSystemWithStargateLinks` on re-add. Emits `system.removed` → `{ id }`. Accepts an optional outer `tx` so `subchain.ts` can soft-delete a whole branch atomically (when `tx` is passed, failures throw instead of returning `{ ok: false }`, so the outer batch rolls back).

**Parameters:**
- `input.mapSystemId` — `ap_map_system.id` (xyflow node id).
- `input.mapId`, `input.characterId` — as above.
- `input.tx` — optional outer transaction to join.

---

### updateSystem(input: UpdateSystemInput): Promise<ActionResult<MapEventPayload>>
Updates intel/position fields. Only keys present in `input.patch` are written (presence detected via `in`, so `null`/`false` are honored). `rallyAt` is a `Date | null` on input and crosses the wire as an ISO string (or null). Throws (rolls back) if no matching row. Emits `system.updated` → `{ id, ...changed }`.

**Parameters:**
- `input.patch` — `UpdateSystemPatch`: `alias`, `tag`, `status`, `intelNotes`, `locked`, `rallyAt`, `positionX`, `positionY` (all optional).

---

### type AddSystemInput / AddSystemResult / RemoveSystemInput / UpdateSystemInput / UpdateSystemPatch
Input bags for the helpers (`AddSystemInput` carries an optional `tx`) plus `AddSystemResult` (`{ payloads: MapEventPayload[] }`, the orchestrator return). Re-exported from `src/types/index.ts`.

### Depends On
- `commitMapEvent`, `enqueueWebhookDispatch` (`./core`) — the single commit primitive + the post-commit webhook enqueue for the orchestrator's `system.added` event.
- `createConnection` (`./connections`) — used by `addSystemWithStargateLinks` to write the gate links (joined to the outer tx).
- `db` (`@/db/client`) — opens the orchestrator transaction.
- `apMapSystem`, `apMapConnection`, `universeStargateEdge`, `universeSystem`, `universeConstellation`, `universeRegion`, `universeSystemStatic`, `universeWormhole` (Drizzle schema) for the node-body re-read + gate-adjacency lookup.
- `mapEventPayloadSchema` variants `system.added` / `system.removed` / `system.updated` (`@/lib/realtime/protocol`).
