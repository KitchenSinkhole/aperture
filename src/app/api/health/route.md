## route.ts (api/health)

**Purpose:** Shallow liveness probe — the external uptime monitor's target.
**File:** `src/app/api/health/route.ts`

---

### GET /api/health
Calls `shallowHealth()` (`src/lib/health/probe.ts` — a single `SELECT 1`). Returns `{ status: 'ok' }` with 200 when the DB answers, `{ status: 'down' }` with 503 otherwise.

- `runtime = 'nodejs'` — needs the DB pool.
- `dynamic = 'force-dynamic'` — never statically cached.
- **Public, no auth** — the external monitor has no credentials.
