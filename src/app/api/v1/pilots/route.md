## route.ts — GET /api/v1/pilots

**Purpose:** Serves the online tracked pilots on the token's map, as the token's owner may see them under Blackout.
**File:** `src/app/api/v1/pilots/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('pilots', 'pilots', …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Response:** `{ ok: true, data: UserApiPilot[], generatedAt }` from the cached `pilots` projection; while Blackout restricts the owner, only that account's own pilots.

### Depends On
- `userApiRoute`, `serveUserApiProjection('pilots')` (`src/lib/userApi/handler.ts`).
