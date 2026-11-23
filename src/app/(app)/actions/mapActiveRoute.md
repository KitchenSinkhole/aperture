## mapActiveRoute.ts

**Purpose:** Server actions for experimental per-map active route sessions (owner-only).
**File:** `src/app/(app)/actions/mapActiveRoute.ts`

---

### setMapActiveRouteAction(input)
Upserts the viewer's single active route row on the map (`map_id` + `owner_user_id` unique). Validates input with `setMapActiveRouteInputSchema`, checks map view access, and requires account ownership of the primary character and every follower before write.

### clearMapActiveRouteAction(input)
Deletes the viewer's active route row for the map.
