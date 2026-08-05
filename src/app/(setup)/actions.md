## (setup) actions.ts

**Purpose:** Server Actions for the `/setup` ops console. Gated by `readSetupCookie()` (a signed, short-TTL cookie minted by `setupUnlockAction` after a `SETUP_PASSWORD` check). Bypasses EVE SSO so an operator can recover from a broken auth deploy.
**File:** `src/app/(setup)/actions.ts`

---

### setupUnlockAction(password: string): Promise<ActionResult>
Constant-time compare against `env.SETUP_PASSWORD`. On match, sets the `ap_setup` cookie via `setSetupCookie()`. Refuses to run when `SETUP_PASSWORD` is empty (no accidental open-deploy). Error message is the generic `'Invalid password.'` to prevent enumeration. Logs `unlock-ok` / `unlock-failed` / `unlock-refused-no-env` (structured logger [[logger]], `warn`) with the request's `x-forwarded-for` so proxy + app logs can be correlated.

### setupLogoutAction(): Promise<ActionResult>
Best-effort delete of the `ap_setup` cookie.

### setupRunMigrations(): Promise<ActionResult<{ applied: number; tags: string[] }>>
Gated. Diffs `src/db/migrations/meta/_journal.json` against `drizzle.__drizzle_migrations` to compute pending entries, then invokes `migrate()` from `drizzle-orm/node-postgres/migrator`. Idempotent — re-running with no pending work returns `{ applied: 0, tags: [] }`. Returns the list of applied tags by their journal `tag` (e.g. `'0014_admin_event_kinds'`).

Every enqueue below passes the task's registered queue (`jobQueueFor`, `src/lib/jobs/registry.ts`) as `add_job`'s `queue_name`, so an on-demand run is serialized against the same jobs its cron is — the three static-data tasks share one queue and never overlap.

### setupRunSdeIngest(): Promise<ActionResult<{ jobId: string }>>
Gated. Enqueues the `sde-ingest` graphile-worker task via `graphile_worker.add_job` — a re-run of the whole ingest pipeline against the build the database already holds. Returns the queued job id as a base-10 string.

### setupRunSdeRefresh(): Promise<ActionResult<{ jobId: string }>>
Gated. Enqueues the `sde-refresh` graphile-worker task via `graphile_worker.add_job` — the daily self-refresh path, run on demand. Ingests CCP's latest build when it is newer than the one the database holds; a no-op when already current. Returns the queued job id.

### setupRunCsvIngest(): Promise<ActionResult<{ jobId: string }>>
Gated. Enqueues the `csv-ingest` graphile-worker task (vendored wormhole CSV re-ingest only — statics/overrides/classes) via `graphile_worker.add_job`. Returns the queued job id. Requires `universe_system`/`universe_type` to be populated first.

### setupRunCronOnDemand(name: string): Promise<ActionResult<{ jobId: string }>>
Gated. Validates `name` against `onDemandJobModules()` from `src/lib/jobs/registry.ts` — the cron-driven, payload-less subset — so the wizard can't enqueue arbitrary strings or payload-required tasks (`location-poll` / `webhook-dispatch`), then enqueues via `graphile_worker.add_job(name, '{}')`. Returns the queued job id. Enqueuing a payload-required task here with an empty payload would crash its handler, so they're kept out of the allowlist.

---

### Instance access configuration
All gated; all wrap [[instanceConfig]] and `revalidatePath('/setup')` so the server-rendered config table refreshes. EVE ids cross the client boundary as digit-strings and are parsed to `bigint` by the schemas (JS numbers can't hold a 64-bit id).

### setupSetAccessMode(mode: string): Promise<ActionResult>
Validates `mode ∈ {open, restricted}` and calls `setAccessMode`. `restricted` gates login on the allowlist; `open` admits any EVE login.

### setupAddOwner(kind: string, principalId: string): Promise<ActionResult>
Validates `kind ∈ {corporation, alliance}` + numeric id, calls `addOwner`. Owner members may always log in; ownership does not elevate `authz_level`.

### setupRemoveOwner(kind: string, principalId: string): Promise<ActionResult>
Validates + calls `removeOwner`.

### setupAddGrant(args: { principalKind; principalId; capability; expiresAt; note }): Promise<ActionResult>
Validates `principalKind ∈ {character, corporation, alliance, role}`, numeric `principalId`, `capability ∈ {login, admin}`, optional `expiresAt` (`datetime-local` string; empty = permanent) and `note`, then calls `addInstanceGrant`. `login` = allowlist entry; `admin` is read by `resolveAuthzLevel` on the next resync.

### setupRemoveGrant(id: string): Promise<ActionResult>
Validates numeric id, calls `removeGrant` (which guards `scope='instance'`).

---

### Notes
- All actions emit a structured `warn` log ([[logger]], `source='server'`) with the client IP (best-effort from `x-forwarded-for`) and the action name. `warn` is stdout-only, so the IP is never persisted to `ap_error_log`. No DB audit row — CLAUDE.md forbids parallel audit tables and `ap_map_event` is map-scoped.
- The unlock action's constant-time compare pads to the longer of the two buffers and checks the length separately so neither bypasses the other.
- `revalidatePath('/setup')` runs on unlock + logout so the page rerenders with the new locked/unlocked state.
- See [[setup-cookie]] for the cookie scaffold and [[env]] for the schema.
