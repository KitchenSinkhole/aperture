## tenancy.ts

**Purpose:** Tenancy-binding asserts reused by the map-child write paths — confirms a body-supplied child id actually belongs to the authorized map, a check the actor-authorization gate (`requireMapMutate`) does not perform.
**File:** `src/lib/map/mutations/tenancy.ts`

---

### assertSystemOnMap(tx: Tx, mapSystemId: bigint, mapId: bigint): Promise<void>
Throws `Error('System does not belong to this map.')` when `mapSystemId` has no row on `mapId`. `ap_map_system.id` is sequential/enumerable, so this stops a caller authorized on one map from naming another map's system id in a write request.

**Parameters:**
- `tx` — the active transaction (asserts run inside the caller's `commitMapEvent` `mutate`).
- `mapSystemId` — the child id to verify.
- `mapId` — the map the caller is authorized on.

---

### assertConnectionOnMap(tx: Tx, connectionId: bigint, mapId: bigint): Promise<void>
Same shape as `assertSystemOnMap`, against `ap_map_connection`. Throws `Error('Connection does not belong to this map.')` when absent.

### Notes
- **Confirmed bindings are memoized per transaction.** A `(childId, mapId)` pair that passes is remembered in a `WeakMap` keyed on the `Tx`, so repeat asserts of the same pair inside one transaction cost nothing — an N-signature paste that asserts its target system up front and again per row issues one query, not N+1. Only passes are recorded; a failure throws and aborts the transaction. Safe because a row's owning map does not change.
- **No `import 'server-only'`.** Reachable from the mutation wrappers (`signatures.ts` / `connections.ts`, both of which carry the guard themselves) the same way `core.ts` is.
