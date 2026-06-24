## connections.ts

**Purpose:** Connection-level map mutations (create / delete / update), each a single `commitMapEvent` call. Connections are hard-deleted on collapse (wormholes don't come back).
**File:** `src/lib/map/mutations/connections.ts`

---

### createConnection(input: CreateConnectionInput): Promise<ActionResult<MapEventPayload>>
Inserts one `ap_map_connection` row between two map systems. Flag defaults: `massStatus = 'fresh'`, `jumpMassClass = null`, `eolStage = 'none'`, booleans `false`; `eol_at` is stamped only when the connection is created at a non-`none` `eolStage`. `confirmed_at` is always set to `now()` — every create (manual draw, sig link, stargate auto-link) is a fresh observation, so the row is born confirmed (dormancy is only applied later by `removeSystem` NULLing incident `wh` rows). Emits `connection.create` with the full edge body (id/source/target/scope/massStatus/jumpMassClass/eolStage + flags). `confirmed_at` is not in the payload — the client never reads it; dormant rows are simply never sent.

**Parameters:**
- `input.sourceMapSystemId` / `input.targetMapSystemId` — endpoint `ap_map_system.id`s.
- `input.scope` — required `connection_scope` (wh|stargate|jumpbridge|abyssal).
- `input.massStatus`, `input.jumpMassClass`, `input.eolStage`, `input.preserveMass`, `input.isRolling`, `input.isStatic` — optional flag overrides. `isStatic` designates the link as the source system's static.
- `input.mapId`, `input.characterId` — map + audit FK.
- `input.tx` — optional outer transaction (joined by `addSystemWithStargateLinks` to write the auto `stargate` gate links atomically with the system add); when passed, failures throw instead of returning `{ ok: false }`.

---

### deleteConnection(input: DeleteConnectionInput): Promise<ActionResult<MapEventPayload>>
Hard-deletes the `ap_map_connection` row matching `(connectionId, mapId)`; attached `ap_map_signature` rows cascade. Throws (rolls back) if no matching row. Emits `connection.delete` → `{ id, source, target }`, where `source`/`target` are the endpoint `ap_map_system.id`s captured from the deleted row (the audit/Discord surfaces resolve them to system names against the persistent `ap_map_system` rows — the connection itself is gone). Accepts optional `input.tx` to join an outer transaction (used by `bulkSignatures.ts` when tearing down WH connections orphaned by `removeOrphanedConnections`).

---

### updateConnection(input: UpdateConnectionInput): Promise<ActionResult<MapEventPayload>>
Updates connection flags; only keys present in `input.patch` change (presence via `in`, so `null`/`false` are honored). Changing `eolStage` re-stamps `eol_at = now()` whenever the stage actually changes to a non-`none` value (so `eol → critical` restarts the 1h clock at the critical observation), preserves the existing stamp on a repeat of the same stage, and clears `eol_at` to null when set back to `none`. `eol_at` crosses the wire as an ISO string (or null) in the payload. Emits `connection.update` → `{ id, source, target, ...changed }` — the endpoint `ap_map_system.id`s ride every update (audit descriptors) so its history entry self-describes even after the connection is later hard-deleted.

**Parameters:**
- `input.patch` — `UpdateConnectionPatch`: `scope`, `massStatus`, `jumpMassClass`, `eolStage`, `preserveMass`, `isRolling`, `isStatic` (all optional). Toggling `isStatic` on a Home-touching link drives the ABC home-static exemption reconcile in the PATCH route.

---

### type CreateConnectionInput / DeleteConnectionInput / UpdateConnectionInput / UpdateConnectionPatch
Input bags for the three helpers. Re-exported from `src/types/index.ts`.

### Depends On
- `commitMapEvent` (`./core`) — the single commit primitive.
- `apMapConnection` (Drizzle schema).
- `mapEventPayloadSchema` variants `connection.create` / `connection.delete` / `connection.update` (`@/lib/realtime/protocol`).
