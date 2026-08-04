## sde-ingest-child.ts

**Purpose:** Thin CLI wrapper over `runIngest()`, spawned as a child process by the `sde-ingest` job task so the ingest never runs on the main app's event loop or shares its `pg.Pool`.
**File:** `scripts/sde-ingest-child.ts`

Calls `runIngest()` from `src/lib/sde/ingest.ts`, prints the resulting `IngestResult` as one JSON line on stdout (the last stdout line — `runIngest`'s own progress logging also goes to stdout via `console.log`), closes the pool, exits `0` on success / non-zero on failure (stack or message on stderr). Reads `DB_POOL_MAX` (set by the spawning task) to size its own dedicated pool. Not invoked directly by a `pnpm` script — `pnpm sde:bootstrap` (`sde-bootstrap.ts`) is the interactive/CLI entry point; this file exists for the job task to spawn.
