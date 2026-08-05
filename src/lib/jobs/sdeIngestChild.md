## sdeIngestChild.ts

**Purpose:** Spawns the isolated SDE-ingest child process and resolves with its `IngestResult`; shared by the `sde-ingest` and `sde-refresh` job tasks.
**File:** `src/lib/jobs/sdeIngestChild.ts`

---

### runSdeIngestChild(override?: SdeIngestOverride): Promise<IngestResult>
Spawns `scripts/sde-ingest-child.ts` by running the project's own `node_modules/tsx/dist/cli.mjs` under the current `node` binary (`process.execPath`, no shell — avoids OS-specific `.bin/tsx` resolution and unescaped-argument spawning), with `DB_POOL_MAX=2` in its env so the child opens a small dedicated `pg.Pool` instead of sharing the caller's. `override` (`{ build, releaseDate }`) is passed through as `SDE_INGEST_BUILD`/`SDE_INGEST_RELEASE_DATE` env vars, telling the child to ingest that build instead of the pinned `SDE_BUILD`. Collects the child's stdout/stderr, resolves with the last stdout line parsed as JSON (the child's `IngestResult`) on a zero exit, and rejects with the last ~20 stderr lines on a non-zero exit, a killing signal, or unparseable output. A child still running after 30 minutes is sent `SIGTERM`, then `SIGKILL` 10s later, and the promise rejects with a timeout error — a wedged ingest cannot hold one of the worker's concurrency slots indefinitely.

### interface SdeIngestOverride
`{ build: number; releaseDate: string }` — the build the child should ingest, when not the pinned bootstrap build.
