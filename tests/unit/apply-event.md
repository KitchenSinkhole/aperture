## apply-event.test.ts

**Purpose:** Unit coverage for the pure `applyEvent` reducer across event kinds, and for `applyCommittedEolFields`, the acting tab's settle after a connection patch.
**File:** `tests/unit/apply-event.test.ts`

No DB required (pure functions). Builds minimal `MapViewData` fixtures.

Covers, per kind:
- `system.added` (append, re-activation upsert, immutability, signatures left to hydration), `system.removed`, `system.updated` (partial merge, lock attribution clear, position, intel notes / rally).
- `connection.create` (append, same-id upsert, an `auto` re-broadcast keeps its provenance), `connection.update` (partial merge incl. `eolAt`, `eolSource` applied when present and kept when absent), `connection.delete`.
- `map.update`, `signature.create` / `update` / `delete`, the no-op kinds, and the user-API header events.

`applyCommittedEolFields`:
- Confirming an estimate: the optimistic payload alone leaves the edge `auto`; folding the committed `connection.update` leaves it `observed` with the server's `eolAt`.
- Only `eolAt` / `eolSource` are taken, so a newer optimistic field (here `massStatus`) survives.
- A response for a stage the edge no longer shows (EOL then Critical, EOL answering last) returns the same state reference.
- A committed update without EOL fields returns the same state reference.
