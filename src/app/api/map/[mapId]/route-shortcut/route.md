## route-shortcut/route.ts

**Purpose:** Experimental read-only resolver for one-click route destinations (nearest high-sec via gates).
**File:** `src/app/api/map/[mapId]/route-shortcut/route.ts`

### GET /api/map/[mapId]/route-shortcut?from=&kind=nearest_highsec
View-guarded. Runs `resolveRouteShortcut` on the static gate graph. Returns `{ ok: true, data: { systemId } }` or `{ ok: false, error }` when no HS system is reachable.
