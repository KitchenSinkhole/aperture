## route.ts (POST /api/character/waypoint)

**Purpose:** Set an on-map system as the autopilot destination on one of the signed-in user's own characters, clearing any existing waypoints, via ESI. A side-effect call into the EVE client — writes **no** `ap_map_event`.
**File:** `src/app/api/character/waypoint/route.ts`

---

### POST(request: NextRequest)
Backs the map's "Set destination" context-menu action.

- `runtime = 'nodejs'`.
- Requires a session (`getSession`); 401 when unauthenticated.
- Body (Zod): either `{ characterId, destinationId }` (single replace) or `{ mode: 'sequence', characterId, waypointSystemIds: number[] }` (at most `CHARACTER_WAYPOINT_SEQUENCE_MAX` ids — currently 10). In sequence mode, only the **first** hop is sent with `clear_other_waypoints: true`; each later hop appends. Stops on the first ESI failure. Invalid JSON / shape → 400.
- Ownership: `assertCharacterOwnership(BigInt(characterId), session.userId)` → 403 when the character isn't the user's (or isn't `active`).
- Single-destination mode calls `setWaypoint` once with `clear_other_waypoints: true`. Sequence mode loops ids serially (see body shape above).
- Returns `{ ok: true, pushed: number }` on full success. On `EsiTokenError` or `EsiHttpError` 401/403 (token predates the `esi-ui.write_waypoint.v1` scope) → `{ ok: false, error: 'Sign out and back in to enable Set destination.' }` (status 400). On `EsiTokenTransientError` → retry-later at 503. On other ESI failures after zero or more successes → `{ ok: false, error: 'Set destination is unavailable right now.', pushed }` at status 502.

### Depends On
- `@/lib/session` — `getSession`, `assertCharacterOwnership`.
- `@/lib/esi/client` — `esiCall`, `EsiHttpError`, `EsiTokenError`, `EsiTokenTransientError`.
- Scope `esi-ui.write_waypoint.v1` (declared in `aperture.config.ts` `ESI_SCOPES`).
