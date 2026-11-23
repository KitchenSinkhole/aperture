## route.ts — GET /api/v1/signatures

**Purpose:** Serves the signatures in the token's map's visible systems to a user API client.
**File:** `src/app/api/v1/signatures/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('signatures', 'signatures', …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Response:** `{ ok: true, data: UserApiSignature[], generatedAt }` from the cached `signatures` projection.

### Depends On
- `userApiRoute`, `serveUserApiProjection('signatures')` (`src/lib/userApi/handler.ts`).
