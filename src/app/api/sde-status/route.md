## GET /api/sde-status

**Purpose:** Static-data health for the layout banner's periodic refetch.
**File:** `src/app/api/sde-status/route.ts`

### Request
No parameters.

### Response
- `200 { ok: true, data: SdeStatus }` — `{ state: 'ok' | 'stale' | 'failing', currentBuild, latestBuild, checkedAt }` from `getSdeStatus()` ([[status]]).
- `401 { ok: false, error }` — no session.

### Behaviour
- Instance-wide rather than map-scoped, so any signed-in character may read it.
- `dynamic = 'force-dynamic'` — the response tracks a mutable DB row.
- Carries no operator detail (failure reason, orphan counts); `/setup` reads those from the row directly.
