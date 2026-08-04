## client.ts

**Purpose:** Singleton `pg` connection pool wired into Drizzle ORM with the full `universe_*` schema.
**File:** `src/db/client.ts`

---

### db
Drizzle client (`drizzle(pool, { schema })`) bound to the singleton pool and the complete schema from `./schema`. Use for all query-builder access.

### pool
The underlying `pg.Pool`. Reused across hot-reloads in non-production via `globalThis.__aperturePool` to avoid connection leaks. Read by `migrate.ts` to close cleanly after migrations. Pool size defaults to `pg`'s own default; a process may set `DB_POOL_MAX` before this module loads to request a smaller dedicated pool (used by `scripts/sde-ingest-child.ts` to avoid over-provisioning connections for a short, sequential ingest run).

### Database
`typeof db` — convenience type for passing the client around.

**Notes:** `DATABASE_URL` is read from the validated `@/lib/env`. `pg` is in `next.config.ts` `serverExternalPackages`.
