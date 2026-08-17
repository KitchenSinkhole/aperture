## subchainGraph.ts

**Purpose:** Pure, client+server-shared graph traversal that resolves which systems make up a "subchain" hanging off a head system, used by the delete-subchain feature.
**File:** `src/lib/map/subchainGraph.ts`

No `server-only` import: the client uses it to preview/highlight the doomed set; the server re-runs it authoritatively before deleting.

A subchain = head + every system **orphaned from the anchor** by removing the head (the keep-side root is the map's Home when set, else a user-picked neighbour). The anchor side, the head's parent, and anything still reachable from the anchor via a loop are all preserved.

---

### computeSubchain(args): Set<string>
Returns the head plus everything orphaned from `args.anchorId` by removing `args.headId`, computed as `(reachable from anchor) \ (reachable from anchor with head removed)` over the undirected graph built from `args.systems` + `args.connections`. If the head is already disconnected from the anchor, the head's whole connected component is returned instead.

**Parameters:**
- `args.systems` — visible systems (`{ id }`, where `id` is `ap_map_system.id` as a string). Defines the node set; edges to non-members are ignored.
- `args.connections` — edges (`{ source, target }`, both `ap_map_system.id`s). Treated as undirected.
- `args.headId` — the system being deleted; the traversal root.
- `args.anchorId` — the keep-side barrier; never entered, never in the result.

**Returns:** Set of `ap_map_system.id`s to delete (includes `headId`, excludes `anchorId`). Empty when `headId === anchorId` or `headId` isn't in `systems`.

---

### computeDisconnected(args): Set<string>
Returns every system in `args.systems` with no path back to `args.homeId` over the undirected graph built from `args.systems` + `args.connections`. Computed as `systems \ (reachable from home)`. Powers the "delete disconnected" pane action.

**Parameters:**
- `args.systems` — visible systems (`{ id }`, `ap_map_system.id` as a string). Defines the node set.
- `args.connections` — edges (`{ source, target }`); treated as undirected, scope-agnostic.
- `args.homeId` — the Home system; the reachability root, never in the result.

**Returns:** Set of disconnected `ap_map_system.id`s (excludes `homeId`). Empty when `homeId` isn't in `systems`.

---

### hopsFromHome(args): Map<string, number>
BFS hop distance from `args.homeId` to every reachable system, over the undirected graph built from `args.systems` + `args.connections`.

**Parameters:**
- `args.systems` — visible systems (`{ id }`, `ap_map_system.id` as a string). Defines the node set.
- `args.connections` — edges (`{ source, target }`); treated as undirected, scope-agnostic.
- `args.homeId` — the Home system; the BFS root. `null` when no Home is set.

**Returns:** Map of `ap_map_system.id` to hop count, with the Home itself at `0`. A system with no path back to Home is absent from the map. Empty when `homeId` is `null` or isn't in `systems`.

---

### neighborsOf(connections, systemId): string[]
Direct neighbours of `systemId`, deduplicated and order-stable by first appearance in `connections`. Powers the no-Home fallback submenu (pick which neighbour to keep).

**Returns:** Array of neighbouring `ap_map_system.id`s.
