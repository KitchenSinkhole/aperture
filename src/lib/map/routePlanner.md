## routePlanner.ts

**Purpose:** Shortest-path route planner (routes-module) over the static stargate graph + the live wormhole chain (+ optional EVE-Scout), with EVE-style safety weighting and wormhole filters. Server-only, read-only (no DB writes, no `ap_map_event`).
**File:** `src/lib/map/routePlanner.ts`

---

### getGateGraph(): Promise<{ adjacency: Map<number, number[]>; trueSec: Map<number, number> }>
The cached undirected K-space stargate adjacency plus each system's `true_sec` (for safety weighting). Loaded once from `universe_stargate_edge` + `universe_system` and memoized for the process lifetime (the SDE is static; a re-ingest needs a restart). Both edge directions are indexed defensively.

---

### loadMapWormholeEdges(mapId: bigint): Promise<RouteOverlayEdge[]>
The map's `wh` + `jumpbridge` connections as overlay edges, with each endpoint resolved to its EVE solar-system id via a double self-join on `ap_map_system`. Only links between two **visible** systems are returned; `stargate` (already in the static graph) and `abyssal` connections are skipped. Wormhole mass/EOL fields are carried for filtering; jumpbridges carry nulls.

**Returns:** `RouteOverlayEdge[]` — `{ from, to, kind, connectionId, jumpMassClass, massStatus, eolStage }`.

---

### loadEveScoutEdges(): Promise<RouteOverlayEdge[]>
The public EVE-Scout Thera/Turnur connections (via `loadTheraConnections`) as `eve_scout` overlay edges (hub ↔ target). No mass band, so never filtered by min-ship / WH-status.

---

### planRoutesOnGraph(input: PlanGraphInput): RawRoutePlan[]
**Pure, DB-free** — the unit-tested core. One Dijkstra from `sourceSystemId` reaches every destination; each path is reconstructed from the shared predecessor map.

- **Edge weight** = `1 + safetyPenalty(entered)`. `shortest` → 0 everywhere; `safer` → 0 highsec / +50 lowsec / +100 null/J-space; `less_safe` → inverted (+50 highsec). Penalties are finite so a reachable destination is never reported unreachable. Reported `jumps` is the true hop count, independent of weighting.
- **Overlay filters** (applied while building overlay adjacency): a WH/eve-scout edge whose `jumpMassClass` ranks below `prefs.minShipClass` (`s<m<l<xl`; null kept) is dropped; a `wh` edge is dropped when its `massStatus`/`eolStage` matches an enabled `avoidReduced`/`avoidCritical`/`avoidEol`.
- Each hop records `via` (`origin`/`gate`/`wh`/`jumpbridge`/`eve_scout`), the `connectionId` it was entered by (mapped links only), and `onMap` (membership in `onMapSystemIds`).

**`PlanGraphInput`:** `{ adjacency, trueSec, overlay, onMapSystemIds, sourceSystemId, destinationSystemIds, prefs }`.

---

### planRoutes(args): Promise<RoutePlan[]>
End-to-end orchestrator: cached gate graph + this map's overlay (+ EVE-Scout when `prefs.includeEveScout`) → `planRoutesOnGraph` → `enrichPlans` (batch-resolves system name/security from `universe_system`, plus each hop's `tag` from the map's visible `ap_map_system` rows loaded by `loadMapSystems`). Wall-clock duration (including failures, via `try/finally`) is observed into `route_plan_duration_ms` (`recordRoutePlan`).

**Parameters:** `{ mapId: bigint; sourceSystemId: number; destinationSystemIds: number[]; prefs: RoutePrefs }`.
**Returns:** `RoutePlan[]` (`{ destinationSystemId, destinationName, reachable, jumps, hops: RouteHop[] }`), one per requested destination, in input order.

---

### type RouteOverlayEdge
A traversable non-gate edge overlaid on the stargate graph (`wh` / `jumpbridge` / `eve_scout`), bidirectional. Exported for the overlay loaders and tests.
