## sde-ingest-child.ts

**Purpose:** Thin CLI wrapper over `runIngest()`, spawned as a child process by `runSdeIngestChild()` so the ingest never runs on the main app's event loop or shares its `pg.Pool`.
**File:** `scripts/sde-ingest-child.ts`

Calls `runIngest(override)` from `src/lib/sde/ingest.ts`, prints the resulting `IngestResult` as one JSON line on stdout (the last stdout line — `runIngest`'s own progress logging also goes to stdout via `console.log`), closes the pool, exits `0` on success / non-zero on failure (stack or message on stderr). Reads `DB_POOL_MAX` (set by the spawning task) to size its own dedicated pool. `override` is read from the `SDE_INGEST_BUILD`/`SDE_INGEST_RELEASE_DATE` env vars (both required together); absent, `runIngest` ingests the pinned `SDE_BUILD`. Not invoked directly by a `pnpm` script — `pnpm sde:bootstrap` (`sde-bootstrap.ts`) is the interactive/CLI entry point; this file exists for `src/lib/jobs/sdeIngestChild.ts` to spawn on behalf of the `sde-ingest` and `sde-refresh` job tasks.
