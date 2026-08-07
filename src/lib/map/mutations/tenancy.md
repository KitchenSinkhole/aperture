## tenancy.ts

**Purpose:** Tenancy-binding asserts reused by the create paths — confirms a body-supplied child id actually belongs to the authorized map, a check the actor-authorization gate (`requireMapMutate`) does not perform.
**File:** `src/lib/map/mutations/tenancy.ts`

---

### assertSystemOnMap(tx: Tx, mapSystemId: bigint, mapId: bigint): Promise<void>
Throws `Error('System does not belong to this map.')` when `mapSystemId` has no row on `mapId`. `ap_map_system.id` is sequential/enumerable, so this stops a caller authorized on one map from naming another map's system id in a create request.

**Parameters:**
- `tx` — the active transaction (asserts run inside the caller's `commitMapEvent` `mutate`).
- `mapSystemId` — the child id to verify.
- `mapId` — the map the caller is authorized on.

---

### assertConnectionOnMap(tx: Tx, connectionId: bigint, mapId: bigint): Promise<void>
Same shape as `assertSystemOnMap`, against `ap_map_connection`. Throws `Error('Connection does not belong to this map.')` when absent.

### Notes
- **No `import 'server-only'`.** Reachable from the mutation wrappers (`signatures.ts` / `connections.ts`, both of which carry the guard themselves) the same way `core.ts` is.
