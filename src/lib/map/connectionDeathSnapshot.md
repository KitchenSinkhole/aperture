## connectionDeathSnapshot.ts

**Purpose:** Reads a connection's death snapshot (`ConnectionDeathSnapshot`) for the `connection.delete` payload, on the transaction that deletes it.
**File:** `src/lib/map/connectionDeathSnapshot.ts`

No `import 'server-only'`: the graphile-worker reaper tasks run under bare tsx and share this reader.

---

### readConnectionDeathSnapshot(tx: Tx, input: ReadConnectionDeathSnapshotInput): Promise<ConnectionDeathSnapshot | null>
Locks the `(connectionId, mapId)` row `FOR UPDATE` and reads its state, its latest `ap_map_connection_log.jumped_at`, and the `universe_wormhole` codes of the `ap_map_signature` rows bound to it. Must run before the delete on the same transaction: the log and the bound signatures cascade with the row. Returns null when no such connection is on the map.

- `lastAliveAt` — the latest of the last logged jump, `confirmed_at` and `updated_at`. A lower bound on "known open at"; true collapse lies in `[lastAliveAt, deletedAt]`.
- `wasDormant` — `confirmed_at IS NULL`.
- `wormholeCode` — `boundWormholeCode` over the bound signatures plus `input.removedBoundSigTypeIds`.
- `cause` — `input.cause`, except a `manual_removed` hole that is `is_rolling` or `mass_status = 'critical'` records `rolled`. Other causes are kept as given.

**Parameters:**
- `tx` — the deleting transaction.
- `input.connectionId` / `input.mapId` — the connection, scoped to its map.
- `input.cause` — any `ConnectionDeathCause` but `rolled`, which is only derived.
- `input.removedBoundSigTypeIds` — optional `type_id`s of signatures bound to the connection that were already deleted earlier in `tx`.

**Returns:** the snapshot, timestamps as ISO strings.

---

### boundWormholeCode(codes: Iterable<string>): string | null
The bound-signature code rule: the single distinct non-K162 code; `K162` when that is the only code; null when there are no codes or the non-K162 codes disagree.

---

### type ReadConnectionDeathSnapshotInput
The input bag above.

### Depends On
- `apMapConnection`, `apMapConnectionLog`, `apMapSignature`, `universeWormhole` (Drizzle schema).
- `Tx` (`@/lib/map/mutations/core`).
