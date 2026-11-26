## mapActiveRouteSchema.ts

**Purpose:** Zod input shape for `setMapActiveRouteAction` (shared with unit tests).
**File:** `src/lib/map/mapActiveRouteSchema.ts`

---

### routePlanSchema / routeHopSchema
Structured Zod models for planner output on the wire (hop `via` enum, capped hop list).

### clearMapActiveRouteInputSchema
`mapId` as a numeric string.

### setMapActiveRouteInputSchema
Validates active-route set payloads. `mapId` is a numeric string; follower list length ≤ `ACTIVE_ROUTE_MAX_FOLLOWERS` (50); hop list ≤ `ACTIVE_ROUTE_MAX_HOPS` (200); `plan.destinationSystemId` must equal `destinationSystemId`.
