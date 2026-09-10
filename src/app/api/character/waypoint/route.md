## route.ts (POST /api/character/waypoint)

**Purpose:** Set an on-map system as the autopilot destination on one of the signed-in user's own characters, clearing any existing waypoints, via ESI. A side-effect call into the EVE client — writes **no** `ap_map_event`.
**File:** `src/app/api/character/waypoint/route.ts`

---

### POST(request: NextRequest)
Backs the map's "Set destination" context-menu action.

- `runtime = 'nodejs'`.
- Requires a session (`getSession`); 401 when unauthenticated.
- Body (Zod): `{ characterId: number, destinationId: number }` — both positive ints; `destinationId` is an EVE solar-system id. Invalid JSON / shape → 400.
- Ownership: `assertCharacterOwnership(BigInt(characterId), session.userId)` → 403 when the character isn't the user's (or isn't `active`).
- Calls `esiCall('setWaypoint', { schema: z.null(), characterId, query: { destination_id, add_to_beginning: false, clear_other_waypoints: true } })` — **replace** semantics (existing waypoints cleared, this system becomes the sole destination). The 204 reply decodes as `null`.
- Returns `{ ok: true }`. On `EsiTokenError` or `EsiHttpError` 401/403 (token predates the `esi-ui.write_waypoint.v1` scope) → `{ ok: false, error: 'Sign out and back in to enable Set destination.' }` (status 400). On `EsiTokenTransientError` (the SSO token endpoint is unreachable, so the token is still good) → a retry-later message at status 503. Any other failure → generic 502.

### Depends On
- `@/lib/session` — `getSession`, `assertCharacterOwnership`.
- `@/lib/esi/client` — `esiCall`, `EsiHttpError`, `EsiTokenError`, `EsiTokenTransientError`.
- Scope `esi-ui.write_waypoint.v1` (declared in `aperture.config.ts` `ESI_SCOPES`).
