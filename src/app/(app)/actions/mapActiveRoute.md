## mapActiveRoute.ts

**Purpose:** Server actions for experimental per-map active route sessions (owner-only).
**File:** `src/app/(app)/actions/mapActiveRoute.ts`

---

### setMapActiveRouteAction(input)
Upserts the viewer's single active route row on the map (`map_id` + `owner_user_id` unique). Validates input with `setMapActiveRouteInputSchema` (numeric `mapId`, plan destination must match top-level destination), checks map view access, verifies the destination exists in `universe_system`, and requires account ownership of the primary character and every follower before write.

### clearMapActiveRouteAction(input)
Deletes the viewer's active route row for the map.
