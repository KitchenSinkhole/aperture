## transitResolve.ts

**Purpose:** Pure resolution of a pilot jump to the mapped wormhole connection it crossed, shared by every client surface that reacts to a traversal.
**File:** `src/lib/map/transitResolve.ts`

---

### BUFFER_TTL_MS: number
How long a caller holds a jump that hasn't resolved yet, waiting for the `connection.create` fold to reach client state, before forgetting it. Bounds the wait so a very late fold can't surface a long-past transit.

---

### resolveTransit(jump, systems, connections): TransitResolution
Matches one jump against the given map state. Both endpoint systems are found by EVE `systemId`; the connections incident to both of them in either direction are considered.

- a `stargate` among the incident connections ⇒ `{ kind: 'drop' }` — a gate jump is never a wormhole transit
- otherwise the first incident `wh` connection ⇒ `{ kind: 'resolved', here, cameFrom, connection }`, where `here` is the destination system and `cameFrom` the source
- either endpoint missing from `systems`, or no incident `wh` ⇒ `{ kind: 'pending' }`

**Parameters:**
- `jump` — `{ fromSystemId, toSystemId }` as EVE solar-system ids
- `systems` — the map systems to resolve the endpoints against
- `connections` — the map edges to search for the crossed hole

**Returns:** A `TransitResolution` discriminated on `kind`. Reads nothing beyond its arguments.
