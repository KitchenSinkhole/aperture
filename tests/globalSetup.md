## globalSetup.ts

**Purpose:** Vitest `globalSetup` that applies all pending Drizzle migrations once, before the parallel test workers spawn.
**File:** `tests/globalSetup.ts`

---

### default setup(): Promise<void>
Opens a one-off `pg.Pool` on `DATABASE_URL` and runs `migrate()` against `src/db/migrations`, then closes the pool. No-op when `DATABASE_URL` is unset.

Runs once in the main process ahead of the workers, so the DB-backed suites' own `beforeAll(migrate)` calls find nothing pending and issue no DDL. That serialises the first-run migration and removes the concurrent CREATE TABLE race that duplicate-keys on `pg_type`.
