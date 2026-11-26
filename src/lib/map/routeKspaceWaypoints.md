## routeKspaceWaypoints.ts

**Purpose:** Derive ESI-safe autopilot waypoint system ids from a computed route (k-space legs only).
**File:** `src/lib/map/routeKspaceWaypoints.ts`

---

### kspaceWaypointSystemIds(hops: RouteHop[]): number[]
Returns ordered EVE `systemId`s for hops that are not wormhole-space (`securityStatus < 0`). Skips the `via: 'origin'` hop.
