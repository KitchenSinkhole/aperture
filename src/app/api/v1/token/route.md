## route.ts — GET /api/v1/token

**Purpose:** Tells a user API client what its token is and what it may do right now.
**File:** `src/app/api/v1/token/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('token', null, …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Response:** `{ ok: true, data: UserApiTokenInfo, generatedAt }`: the token's map, granted and effective scopes, expiry, and the rate limits it is subject to. Any live token may call it.

### Depends On
- `userApiRoute`, `serveUserApiToken` (`src/lib/userApi/handler.ts`).
