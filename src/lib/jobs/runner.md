## runner.ts

**Purpose:** graphile-worker boot, shutdown, and one-shot helpers. Owns the long-lived `Runner` for the embedded worker process.
**File:** `src/lib/jobs/runner.ts`

---

### startWorker(extraModules?): Promise<Runner>
Idempotent boot. Runs graphile-worker's own `runMigrations` to create/upgrade the `graphile_worker` schema, re-arms the location-poll loop after an unclean shutdown (see below), then calls `run({ pgPool, taskList, parsedCronItems, … })` and returns the `Runner`. Repeat calls in the same process return the existing instance.

`extraModules` appends to the registered set in `registry.ts` — primarily for tests / scripts that need a one-off task.

### stopWorker(): Promise<void>
Graceful shutdown via `runner.stop()`. No-op when no worker is running. Wired into `server.ts`' SIGTERM/SIGINT handlers.

### runWorkerOnce(extraModules?): Promise<void>
Run every due cron job once and exit. Used by `pnpm worker:once`. Runs migrations first so a fresh DB works.

### isWorkerRunning(): boolean
Whether `startWorker` has booted in this process. For tests/health.

### reapExhaustedLocationPollZombies(): Promise<void>
Delete exhausted, unkeyed `location-poll` jobs (`key IS NULL AND locked_at IS NULL AND attempts >= max_attempts`, task resolved via `_private_tasks.identifier`). Called once during `startWorker` boot after the re-arm; exported so it is directly exercisable. Logs the reap count at `info`. See the "Location-poll zombie reap" note for why these rows are duplicates that get deleted rather than revived.

### Notes
- **Shares the app's `pg.Pool`** (`@/db/client.pool`) — no separate connection pool for the worker. graphile-worker's LISTEN client is internal to the runner.
- **`noHandleSignals: true`** — `server.ts` owns process signals and shuts the worker down explicitly. Letting graphile-worker install its own SIGTERM handler would race with our HTTP server shutdown.
- **Location-poll re-arm (all environments).** Before `run()`, `startWorker` revives any *stalled* `location-poll` job (`key LIKE 'location-poll:%'`) — clearing the lock, resetting `attempts` + `last_error`, and pulling `run_at` to now. Two stall modes are covered: (1) an **orphaned lock** (`locked_at IS NOT NULL`) from an unclean shutdown — graphile-worker 0.16 only reclaims it after a **hardcoded 4h** (`resetLockedAt`; `min/maxResetLockedInterval` change only the sweep cadence, not the threshold); (2) **exhausted retries** (`attempts >= max_attempts`) — a permanently-failed job graphile never runs again and nothing re-enqueues (the per-map seed marker already exists), so the loop is dead for good. Both leave a character silently untracked with no other recovery path. `location-poll` is a single self-perpetuating job per character, so a prod crash (OOM/SIGKILL/power loss), `tsx watch` hard-killing the dev child on Windows, or an error walking the loop to its attempt cap would otherwise stop tracking until the user toggles it off/on. Scoped to `location-poll` only because it's idempotent (jump-fold dedupe + `jobKey: 'replace'`); a long, non-idempotent job like `sdeIngest` held by a still-draining instance must not be reset, which is why a worker-scoped `force_unlock_workers` is **not** used. Other tasks fall back to graphile-worker's own 4h recovery.
- **Location-poll zombie reap (all environments).** Immediately after the re-arm, `startWorker` **deletes** exhausted, unkeyed `location-poll` rows (`key IS NULL AND locked_at IS NULL AND attempts >= max_attempts`, task resolved via `_private_tasks.identifier`). Distinct from the re-arm: these carry a NULL key (a running row whose key `jobKeyMode:'replace'` nulled before it exhausted its retries), so they are **duplicates** of the one live keyed job per character and are deleted rather than revived. The re-arm's `key LIKE 'location-poll:%'` never matches them, so without this they accumulate forever. The `locationPoll.ts` clean-return-on-outage fix stops new ones being minted; this clears any legacy backlog on boot and is cheap defense-in-depth. Reap count is logged at `info`.
- **Graceful shutdown still primary.** `server.ts` catches SIGTERM/SIGINT → `stopWorker()` → `runner.stop()`, releasing all locks cleanly. That covers prod redeploys and Ctrl+C; the re-arm above is the safety net for the cases where no catchable signal is delivered.
- The `graphile_worker` schema name is the library default — kept as-is; no operational reason to rename.
- `concurrency` and `pollInterval` come from `apertureConfig`. LISTEN/NOTIFY drives the fast dispatch path; the poll interval is only the fallback for scheduled retries.
- The re-arm count is reported through the structured logger ([[logger]], `source='job'`) at `info`.
