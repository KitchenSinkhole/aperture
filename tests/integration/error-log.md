## error-log.test.ts

**Purpose:** Covers observability phase 4 — `scrubContext` PII handling and the structured logger's `ap_error_log` persistence path.
**File:** `tests/integration/error-log.test.ts`

### Scope
- **`scrubContext` (pure, always runs):** denylisted keys (`characterName`, `ip`, `email`, `x-forwarded-for`, `User_Agent`, …) are replaced with `'[redacted]'` while ids (`characterId`, `mapId`, `systemId`) pass through; key matching is case/separator-insensitive; an `Error` value flattens to `{ name, message, stack }`; empty/absent input returns `undefined` (→ SQL `NULL`).
- **Logger persistence (DB-gated, `RUN_DB_TESTS=1`):**
  - `getLogger('job').error(...)` lands exactly one `ap_error_log` row with `level='error'`, `source='job'`, `character_id` NULL (none supplied), and a **scrubbed** `context` (`characterName` redacted, `mapId` kept). The write is fire-and-forget, so the test polls for the row.
  - `getLogger('server').warn(...)` lands **no** row (only `error`/`fatal` persist).

### Notes
- Gated by `RUN_DB_TESTS=1` against the live dev DB; runs `migrate()` in `beforeAll`. Rows are namespaced by a `errlog-test-<ts>-` message prefix and deleted in `afterAll` (append-only table, no snapshot/restore needed).
- See [[logger]] / [[scrub]] for the units under test.
