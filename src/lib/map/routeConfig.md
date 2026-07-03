## routeConfig.ts

**Purpose:** Server-side initial load for the route planner panel (routes-module) — the account's route settings + saved destinations.
**File:** `src/lib/map/routeConfig.ts`

---

### loadRouteConfig(userId: number): Promise<{ prefs: RoutePrefs; destinations: RouteDestinationView[] }>
Reads the `ap_user` route-planner columns into a `RoutePrefs` (defaults applied when the row is somehow missing) and the account's `ap_route_destination` rows joined to `universe_system` for each destination's name/security label/raw security status, ordered by `created_at`. Called at map-page load and threaded into `MapCanvas` → `RoutePlannerModule`.
