## route.ts — GET /api/v1/kills

**Purpose:** Serves cached kills in the visible systems of the token's map.
**File:** `src/app/api/v1/kills/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('kills', 'kills', …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Query:**
- `since=<ISO>` — kills at or after this time. Default 24 hours back; earlier than 7 days back reads as 7 days back; unparseable reads as the default.
- `limit=<n>` — at most this many kills, newest first. Default and maximum 200; below 1 reads as 1; unparseable reads as the default.

**Response:** `{ ok: true, data: UserApiKill[], generatedAt }`.

Reads only the local `universe_killmail` cache, which the zKillboard live feed fills for systems on active maps and the in-app killboard fills cache-aside; the request path never calls zKillboard or ESI, so coverage is best-effort.

### Depends On
- `userApiRoute`, `serveUserApiKills` (`src/lib/userApi/handler.ts`).
