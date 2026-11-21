## route.ts — GET /api/v1/notes

**Purpose:** Serves the token's map's free-standing notes and each visible system's intel-notes text.
**File:** `src/app/api/v1/notes/route.ts`

### GET / OPTIONS
Exported through `userApiRoute('notes', 'notes', …)` (`src/lib/userApi/handler.ts`), which runs the whole request pipeline, shapes the envelope and headers, and answers the CORS preflight. Bearer token only; the token alone selects the map, so the route takes no map id.

**Response:** `{ ok: true, data: UserApiNotes, generatedAt }` from the cached `notes` projection.

### Depends On
- `userApiRoute`, `serveUserApiProjection('notes')` (`src/lib/userApi/handler.ts`).
