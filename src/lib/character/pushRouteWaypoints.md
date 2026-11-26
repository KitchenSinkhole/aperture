## pushRouteWaypoints.ts

**Purpose:** Push a computed route's k-space legs to ESI autopilot for one character.
**File:** `src/lib/character/pushRouteWaypoints.ts`

---

### pushKspaceWaypointsForCharacter(characterId, hops)
Filters `hops` with `kspaceWaypointSystemIds` and POSTs `/api/character/waypoint` in `sequence` mode (first leg clears existing waypoints). Toasts on failure via `requestJson`.
