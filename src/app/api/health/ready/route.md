## route.ts (api/health/ready)

**Purpose:** Deep readiness probe — per-component health map with an overall status.
**File:** `src/app/api/health/ready/route.ts`

---

### GET /api/health/ready
Calls `deepHealth()` (`src/lib/health/probe.ts`) and returns the `HealthReport` (`@/types`): `{ status, checkedAt, components: { db, realtimeBus, worker, esi, migrations } }`. HTTP 503 iff `status === 'down'` (a critical component is out), else 200.

- `runtime = 'nodejs'` — needs the DB pool.
- `dynamic = 'force-dynamic'` — never statically cached.
- **Public, no auth**, no PII in the payload — feeds the external monitor, alerting (Phase 6), and status pages.
