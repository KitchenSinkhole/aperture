## eol-source-provenance.test.ts

**Purpose:** Integration coverage for `eol_source` on every human EOL write path (create, update, map transfer), asserted against both the `ap_map_connection` row and the stored `ap_map_event.payload` so a field the zod schema strips fails the test.
**File:** `tests/integration/eol-source-provenance.test.ts`

Gated on `RUN_DB_TESTS=1`. Scoped to its own maps (matched by name) and `98176xxx` universe rows, removed in `beforeAll` and `afterAll`. Fixture connections with a preset `('eol', 'auto')` are direct inserts, standing in for the auto-EOL cron.

Cases:
1. **create**: `createConnection` at `eol` stores `observed`; without an `eolStage` it stores NULL.
2. **update, every stage**: successive `eol` / `critical` / `expired` patches each store `observed`; undoing to `none` stores NULL, and a repeat `none` keeps NULL.
3. **clear an estimate**: `none` over an `('eol', 'auto')` row stores `observed`, and a repeat `none` keeps it.
4. **untouched**: a patch without `eolStage` on an `auto` row leaves it `auto`, and the payload carries no `eolSource`.
5. **confirm an estimate**: re-applying `eol` on an `('eol', 'auto')` row flips it to `observed` and advances `eol_at`; the payload's `eolAt` matches the row.
6. **observed repeat**: re-applying `eol` on an `('eol', 'observed')` row keeps `eol_at`.
7. **transfer round-trip**: an opted-in map with `auto`, `observed` and NULL rows exports `autoEolConnections: true` and each `eolSource`, and imports with every pair intact (row and stored payload).
8. **legacy file**: an export with no `eolSource` and no `autoEolConnections` parses the flag as `false` and imports an `eol` row as `observed` and a `none` row as NULL.
9. **edited file**: a file pairing `auto` with `critical` and `expired` imports both as `observed` (row and stored payload), while `eol` with `auto` stays `auto`.
