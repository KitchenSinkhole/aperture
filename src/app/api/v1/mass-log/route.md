## route.ts — GET /api/v1/mass-log

**Purpose:** Serves the per-jump mass log of the token's map's current connections.
**File:** `src/app/api/v1/mass-log/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('mass-log', 'mass_log', …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Query:** optional `?connection=<id>` narrows to one connection (`UserApiConnection.id`).

**Response:** `{ ok: true, data: UserApiMassLogEntry[], generatedAt }`; `{ ok: true, data: [], hidden: true, generatedAt }` while Blackout withholds the log from the token's owner.

### Depends On
- `userApiRoute`, `serveUserApiMassLog` (`src/lib/userApi/handler.ts`).
