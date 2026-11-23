## route.ts — GET /api/v1/map

**Purpose:** Serves the token's map header, visible systems and confirmed connections to a user API client.
**File:** `src/app/api/v1/map/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('map', 'map', …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Response:** `{ ok: true, data: UserApiMap, generatedAt }` from the cached `map` projection. No intel-notes text.

### Depends On
- `userApiRoute`, `serveUserApiProjection('map')` (`src/lib/userApi/handler.ts`).
