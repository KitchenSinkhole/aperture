## sde-ingest.test.ts

**Purpose:** Real-Postgres integration coverage for the `sde-ingest` job task — which build an on-demand re-ingest resolves to, and the `ap_sde_state` bookkeeping when it fails.
**File:** `tests/integration/jobs/sde-ingest.test.ts`

### Running
Gated behind `RUN_DB_TESTS=1`. `ap_sde_state` is a real singleton the rest of the app also reads, so `beforeAll` snapshots the live row and `afterAll` restores it — this suite never leaves the dev DB's SDE-build bookkeeping altered.

```
docker compose up -d
pnpm db:migrate
RUN_DB_TESTS=1 pnpm test sde-ingest
```

### Mocking
`runSdeIngestChild` (`@/lib/jobs/sdeIngestChild`) is mocked, so the child process is never spawned and a test asserts on the override the task passes it rather than on a real ingest.

### Cases
- A state row recording a build past the pin: the child is called with that build and its release date, never the pin.
- No state row: falls back to `SDE_BUILD`/`SDE_RELEASE_DATE`.
- The child rejecting with a row present: `failed_at`/`failure_reason`/`consecutive_failures` are written and `current_build` is untouched.
- The child rejecting with no row present: the failure creates the row, leaving `current_build` null.

### Depends On
- `sdeIngest` (`@/lib/jobs/tasks/sdeIngest`), `SDE_BUILD`/`SDE_RELEASE_DATE` (`@/lib/sde/ingest`), `runSdeIngestChild` (`@/lib/jobs/sdeIngestChild`).
