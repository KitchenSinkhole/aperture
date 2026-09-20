## routes.ts

**Purpose:** Per-account route-planner config Server Actions (routes-module) over `ap_user` (settings) and `ap_route_destination` (saved destinations). Personal config — never emits an `ap_map_event`.
**File:** `src/app/(app)/actions/routes.ts`

---

### setRoutePrefsAction(input: unknown): Promise<RouteActionResult>
Persists the account's route-planner settings to the `ap_user` route columns. `input` is validated with `routePrefsSchema` (`src/lib/map/routePrefs.ts`); a parse failure returns `{ ok: false, error: 'Invalid route settings.' }`. Revalidates the `/` layout. Returns `{ ok: true }`.

---

### addRouteDestinationAction(input: unknown): Promise<RouteActionResult<RouteDestinationView>>
Saves a destination for the account. Validates `{ systemId, label? }`, confirms `systemId` resolves to a `universe_system`, then upserts on the `(user_id, system_id)` unique key (a duplicate just re-labels — no error). Returns the destination joined to its system display fields (`RouteDestinationView`) so the panel folds it optimistically. `{ ok: false, error: 'No such system.' }` when the system id is unknown.

---

### removeRouteDestinationAction(destinationId: number): Promise<RouteActionResult>
Deletes a saved destination, scoped to the session account (an id owned by another account is a no-op). Revalidates the `/` layout. Returns `{ ok: true }`.

---

### RouteActionResult<T = undefined> (type)
`{ ok: true }` (when `T` is `undefined`) or `{ ok: true; data: T }`, else `{ ok: false; error: string }`.
