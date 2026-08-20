## sde-decoders.test.ts

**Purpose:** Proves the SDE parse boundary (`parseSdeArchive`, `./decoders.ts`) fails loudly before any DB write on format drift, that the shrink-gate comparison (`findShrunkenTables`) is correct in isolation, and that `DELETION_SPECS` stays leaf-first as the schema grows.
**File:** `tests/unit/sde-decoders.test.ts`

### Setup
- Builds a minimal valid nine-file SDE archive with `adm-zip` (`new AdmZip()` + `addFile` + `writeZipPromise`), JSONL-stringified, written to a per-case temp directory (`node:fs/promises mkdtemp`) since `parseSdeArchive` reads a path and streams entries off disk rather than an in-memory handle. Each entry can be overridden per case (including omitted entirely, to simulate a missing zip entry). Temp directories are removed in `afterEach`.
- No DB, no `RUN_DB_TESTS` gate — `parseSdeArchive` takes no DB dependency, so the "fails before any write" guarantee needs no DB assertion.

### Cases
- `parseSdeArchive` parses the minimal valid archive into the expected rows, sets, and derived maps.
- A malformed line (invalid JSON) rejects with `SdeFormatError` naming the file.
- A line that isn't a JSON object (a top-level list) rejects with `SdeFormatError` naming the file.
- A line with no `_key` rejects with `SdeFormatError` naming the file.
- Renaming a required key (`solarSystemID` → `solar_system_id`) rejects with `SdeFormatError` naming the file, the entry key, and the field path.
- A missing zip entry rejects with `SdeFormatError`.
- `findShrunkenTables`: within threshold, over threshold, a live count of 0 skipped, several offending tables reported together, and a table entirely missing from `newCounts` treated as a 100% shrink.
- `DELETION_SPECS`: for every spec, every guard table that is itself under deletion sync appears at an earlier index — the regression guard for the leaf-first ordering `syncSdeDeletions` relies on for transitive retention. Pure, no DB: reads the exported spec list and resolves guard table names via `getTableName` from `drizzle-orm`.

### Depends On
- `@/lib/sde/ingest` (`parseSdeArchive`, `findShrunkenTables`, `DELETION_SPECS`), `@/lib/sde/decoders` (`SdeFormatError`).
