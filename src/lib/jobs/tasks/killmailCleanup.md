## killmailCleanup.ts

**Purpose:** Retention reaper for the `universe_killmail` cache — deletes killmails older than the retention window by kill time.
**File:** `src/lib/jobs/tasks/killmailCleanup.ts`

---

### killmailCleanup: JobModule
`name: 'killmail-cleanup'`, cron `apertureConfig.KILLMAIL_CLEANUP_CRON` (daily, 04:20 UTC — outside the 11:00 EVE downtime window). Handler wrapped in `withInstrumentation`.

**Behaviour:**
- Deletes `universe_killmail` rows whose `killmail_time` is older than `KILLMAIL_CACHE_RETENTION_DAYS`, in `JOB_DELETE_BATCH_SIZE` chunks (via an `IN (SELECT … LIMIT …)` subquery) until the backlog is drained.
- Returns `{ deleted }` (total rows removed across all batches) as the instrumentation note.

### Depends on
- `@/db` (`universeKillmail`), `aperture.config` (`KILLMAIL_CACHE_RETENTION_DAYS`, `KILLMAIL_CLEANUP_CRON`, `JOB_DELETE_BATCH_SIZE`), `../withInstrumentation`.
