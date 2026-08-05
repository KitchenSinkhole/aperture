## sde-refresh.test.ts

**Purpose:** Real-Postgres integration coverage for the `sde-refresh` job task — the manifest-check/no-op path, a successful delta ingest, the `behind_since` clock, a failed ingest's `ap_sde_state` bookkeeping, and the absent-row seed fallback.
**File:** `tests/integration/jobs/sde-refresh.test.ts`

### Running
Gated behind `RUN_DB_TESTS=1`. `ap_sde_state` is a real singleton the rest of the app also reads, so `beforeAll` snapshots the live row and `afterAll` restores it — this suite never leaves the dev DB's SDE-build bookkeeping altered.

```
docker compose up -d
pnpm db:migrate
RUN_DB_TESTS=1 pnpm test sde-refresh
```

### Mocking
`fetchLatestSdeManifest` (`@/lib/sde/ingest`) and `runSdeIngestChild` (`@/lib/jobs/sdeIngestChild`) are both mocked — the child process is never actually spawned, so a test controls "manifest reports a newer build" and "the ingest gate failed" independently of network access or a real SDE zip.

### Cases
- `latest_build <= current_build`: `checked_at`/`latest_build` still update, but `runSdeIngestChild` is never called.
- `latest_build > current_build`: calls `runSdeIngestChild({ build, releaseDate })`; the mock reproduces the real child's own `ap_sde_state` success write, asserting the row it leaves behind.
- Three consecutive checks over one seeded row: the first gap stamps `behind_since`, a second check against the same gap leaves the stamp untouched, and a check that finds the builds converged clears it to `null`.
- The child rejecting: `ap_sde_state.failed_at`/`failure_reason`/`consecutive_failures` are written directly by the task (not by the child, which never got to record anything), `current_build` is untouched, and the task re-throws so `ap_job_run` records the failure too.
- No row present: seeds `current_build` from the pinned `SDE_BUILD` before comparing, without calling the child.

### Depends On
- `sdeRefresh` (`@/lib/jobs/tasks/sdeRefresh`), `fetchLatestSdeManifest`/`SDE_BUILD`/`SDE_RELEASE_DATE` (`@/lib/sde/ingest`), `runSdeIngestChild` (`@/lib/jobs/sdeIngestChild`).
