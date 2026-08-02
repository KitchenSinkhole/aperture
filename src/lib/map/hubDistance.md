## hubDistance.ts

**Purpose:** Unrestricted gate-jump distance from every system to its nearest major trade hub.
**File:** `src/lib/map/hubDistance.ts`

Distinct from `universe_system.nearest_trade_hub_jumps`, which is computed over a high-sec-only subgraph capped at each hub's `proximityJumps` radius and is therefore null for low-sec, null-sec, and distant high-sec systems. This module traverses the full stargate graph, so every gate-connected system resolves. The distance carries no safety guarantee — it is the shortest gate path, which may cross low- or null-sec.

`server-only`.

---

### type HubDistance
`{ name: string; jumps: number }` — the nearest hub's display name and the gate-jump count to it.

---

### nearestHubJumps(): Promise<Map<number, HubDistance>>
Nearest-hub distance keyed by EVE solar-system id, memoized for the process lifetime (the stargate graph is static SDE data). Reuses the memoized adjacency from `getGateGraph()` in `routePlanner.ts`, so it adds no query of its own.

Delegates to `nearestHubOnGraph` with `apertureConfig.ROUTE_HUBS`.

**Returns:** a map covering every system gate-connected to at least one hub. Systems on a disjoint gate network (isolated Pochven, Zarzakh) and wormhole systems are absent.

---

### nearestHubOnGraph(adjacency, hubs): Map<number, HubDistance>
A single multi-source BFS seeded with every hub at distance 0, each visit carrying the hub it descends from. BFS visits in non-decreasing distance order, so the first visit to a system is by definition from its nearest hub — one pass answers for every hub rather than one pass each plus a minimum. Where two hubs tie, the one earlier in `hubs` wins.

Pure and DB-free, so the unit tests drive it directly.

**Parameters:**
- `adjacency` — undirected gate adjacency, system id → neighbour ids
- `hubs` — the hubs to measure from, in priority order

**Returns:** nearest-hub distance for every system reachable from at least one hub. Unreachable systems are absent, and no distance cap is applied.

---

### __resetHubDistanceCache(): void
Test seam. Drops the memoized promise so the next `nearestHubJumps()` call recomputes.
