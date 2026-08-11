## locationToConnection.ts

**Purpose:** Pure jump classifier used by the location-poll fan-out. Decides whether a system transition is a gate jump (no map writes) or a wormhole jump (fold onto tracked maps as `system.added` / `connection.create` events).
**File:** `src/lib/map/locationToConnection.ts`

---

### type JumpClass
`'gate' | 'wormhole' | 'teleport' | 'abyssal'`. Aperture treats every non-gate, in-space transition as a wormhole unless it matches a more specific class. `teleport` is a non-gate transition where the pilot arrives **docked** in k-space — pod self-destruct ("pod express"), getting podded by hostiles, or a jump clone. `abyssal` is any transition where **either** endpoint is an abyssal system (`security = 'A'`); abyssals are entered only via single-use filaments, so the link is never a re-traversable chain edge. Rarer in-space cases (cyno, jump bridge) are not modelled here and still fall through to `wormhole`.

### classifyJump({ fromSystemId, toSystemId, arrivedDocked }): Promise<JumpClass>
Single SQL probe that returns the `universe_stargate_edge` bidirectional adjacency `EXISTS` (defensive against a future SDE ingest that stops mirroring each gate pair), an `EXISTS` over either endpoint having `universe_system.security = 'A'` (abyssal), **and** the destination's `universe_system.security` label — all in one round-trip.

- gate-adjacent → `'gate'`.
- either endpoint abyssal → `'abyssal'`. The caller (`locationCommit.ts`) folds it as a `scope='abyssal'` connection only on maps with `ap_map.track_abyssal_jumps` set.
- not adjacent, `arrivedDocked`, and destination is k-space (`security ∈ {H, L, 0.0}`) → `'teleport'`. You can never exit a wormhole already docked, so a docked arrival in a non-gate-adjacent system is a teleport-to-station, never a traversal. Gated to k-space because medical/jump clones can only live there.
- otherwise → `'wormhole'`.

`arrivedDocked` is derived by the caller from `station_id`/`structure_id` on the `getCharacterLocation` payload (present only when docked).

`fromSystemId === toSystemId` short-circuits to `'gate'` so the location-poll can call it without a same-system pre-check — same-system means "no jump", which is functionally the same as "ignore this transition".

### gateAdjacencyCondition(from, to)
Drizzle-builder equivalent of the `EXISTS` condition, exposed for callers that want to compose it into a larger query. Not used internally; the raw SQL in `classifyJump` reads more clearly.

### Notes
- `universe_stargate_edge` has its PK on `(from_system_id, to_system_id)` and a secondary index on `to_system_id`. The bidirectional probe hits the PK either way.
- This is a read-only helper — no transaction needed. The poll calls it outside any commit and uses the result to gate whether `foldJumpOntoMap` runs.
