## publicEntrances.ts

**Purpose:** Derive the k-space ways into a publicly-shared chain, server-side.
**File:** `src/lib/map/publicEntrances.ts`

The spectator view never infers entrances from the payload — the projection is computed here so the redaction profile stays the only thing that decides what a public viewer sees (design invariant 1). `server-only`.

---

### type PublicMapEntranceHop
One wormhole jump along the way from a k-space entrance to the map's Home.

| Field | Type | Meaning |
|---|---|---|
| `connectionId` | string | `ap_map_connection.id` of the hole to jump |
| `sigId` | string \| null | code to scan in the system you are standing in; null when unknown or the token withholds codes |
| `mapSystemId` | string | `ap_map_system.id` you arrive in, matching a canvas node id |
| `systemId` | number | EVE solar-system id you arrive in |
| `name` | string | name of the system you arrive in |
| `security` | string \| null | security label of the arrival system, e.g. `C5` |
| `tag` | string \| null | the operator's short tag for the arrival system, e.g. `VFD`; null when untagged |

---

### type PublicMapEntrance
One mapped wormhole leading into the chain from k-space.

| Field | Type | Meaning |
|---|---|---|
| `connectionId` | string | `ap_map_connection.id` of the wormhole; identifies the row |
| `mapSystemId` | string | `ap_map_system.id` of the k-space side, matching a canvas node id |
| `systemId` | number | EVE solar-system id |
| `name` | string | |
| `security` | string \| null | `universe_system.security` label |
| `trueSec` | number \| null | |
| `regionName` | string | |
| `sigId` | string \| null | code to scan in this k-space system; null when unknown or the token withholds codes |
| `farSigId` | string \| null | the code on the far side, inside the chain |
| `leadsTo` | string \| null | security label of the far system, e.g. `C5` |
| `pathHome` | `PublicMapEntranceHop[]` \| null | hop-by-hop way to the map's Home, starting with this entrance hole itself; null when this hole does not lead home |
| `route` | `{ hubName, jumps }` \| null | shortest gate path to the nearest hub; null when unreachable |

A k-space system with two holes into the chain yields two rows — they are two separate sets of directions. `route` is the k-space gate path to a trade hub, a different concept from `pathHome`, which is the wormhole path through the chain.

---

### derivePublicEntrances(systems, connections, homeMapSystemId): Promise&lt;PublicMapEntrance[]&gt;
Every visible k-space system carrying at least one `wh` connection, paired with the code to scan there and the gate distance to reach it.

**Parameters:**
- `systems` — the projected `PublicMapSystemNode[]`
- `connections` — the projected `PublicMapConnectionEdge[]`
- `homeMapSystemId` — `ap_map_system.id` of the map's Home, or null when none is designated

K-space is decided by the `universe_system.security` label (`H`, `L`, `0.0`, `P`); `A` (Abyssal) and the `C1`–`C6` classes are not gate-reachable entrances. `sigId` / `farSigId` read straight off the connection's `sigIds`, so they are governed by the token's `showConnectionSigIds` flag with no second gate. `route` comes from `nearestHubJumps()`.

`pathHome` runs a breadth-first search from the far endpoint with the entrance's own k-space system excluded from the graph, then reconstructs the shortest path and maps each jump's outbound sig off the departing system's side of its connection. The exclusion is what distinguishes the two holes out of one k-space system: without it, a hole leading away from Home would still reach Home by routing back out through the system the guest is standing in.

**Returns:** rows ordered nearest-hub-first with unreachable systems last, ties broken by name.
