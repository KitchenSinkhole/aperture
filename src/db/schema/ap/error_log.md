## error_log.ts

**Purpose:** Bounded server/job/client error history (`ap_error_log`); one row per persisted error-level log.
**File:** `src/db/schema/ap/error_log.ts`

---

### apErrorLog
Drizzle table `ap_error_log`. Daily-partitioned by `occurred_at` via pg_partman (DDL in `0045_error_log.sql`; this definition is for type inference only).

**Columns:**
- `id` (bigserial) — PK part 1.
- `occurredAt` (`occurred_at`, timestamptz) — when the error happened. PK part 2 and partition key.
- `level` (`error_level` enum) — `warn` | `error` | `fatal`. Only `error`/`fatal` are written today.
- `source` (`error_source` enum) — `server` | `job` | `client`.
- `message` (text) — the log message.
- `characterId` (`character_id`, bigint, nullable) — FK → `ap_character.id` `ON DELETE SET NULL` (erasing a character must not wipe error history).
- `context` (jsonb, nullable) — **scrubbed** structured context (stack, ids); never character names / IPs / emails.

**Notes:** Written by the structured logger's `error`/`fatal` path ([[logger]]) and the Phase 7 client-error ingest. Retention is 30 days, enforced by pg_partman (`part_config` set in the migration) and the existing `partition-maintenance` job — rolloff is `DETACH/DROP PARTITION`, not `DELETE` (no dedicated reap task). Empty until an error is logged.
