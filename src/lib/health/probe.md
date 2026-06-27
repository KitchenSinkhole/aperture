## probe.ts

**Purpose:** Read-only health probes behind `/api/health` (shallow) and `/api/health/ready` (deep) — the single internal source of truth for "am I healthy."
**File:** `src/lib/health/probe.ts`

No `import 'server-only'` — this module must load from any runtime and is reused by alerting (Phase 6).

---

### shallowHealth(): Promise<boolean>
Cheap liveness check for the external uptime monitor: a single `SELECT 1` on the pool.

**Returns:** `true` if the DB answered, `false` on any failure.

---

### deepHealth(): Promise<HealthReport>
Probes five components and folds them into one overall status (the worst component). Run `db`, `worker`, and `migrations` checks concurrently; `realtimeBus` and `esi` are synchronous in-process reads.

Components:
- `db` — `SELECT 1` on `pool`; `down` on failure.
- `realtimeBus` — `ok` when `bus.isHealthy()` **or** `bus.subscriberCount() === 0` (an idle bus is lazily disconnected, not unhealthy); `degraded` when subscribers exist but the LISTEN dropped.
- `worker` — `latestFinishedRun()` within `HEALTH_WORKER_STALE_MS`; `down` if stale or no job has ever finished.
- `esi` — `openBreakerCount()`; `degraded` when any breaker is open, else `ok`.
- `migrations` — compares `max(created_at)` in `drizzle.__drizzle_migrations` against the latest `when` in `meta/_journal.json` (drizzle stores `created_at` = the journal `when`); `down` if behind, missing, or the table is unreadable.

**Returns:** a `HealthReport` (`@/types`). Severity ranks `down (2) > degraded = unknown (1) > ok (0)`; the route 503s iff `status === 'down'`.

### Depends On
- `pool` (`@/db/client`), `bus` (`@/lib/realtime/bus`), `openBreakerCount` (`@/lib/esi/breaker`), `latestFinishedRun` (`@/lib/jobs/queries`), `apertureConfig.HEALTH_WORKER_STALE_MS`, and the migration journal `@/db/migrations/meta/_journal.json`.
