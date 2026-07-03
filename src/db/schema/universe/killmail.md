## killmail.ts

**Purpose:** The `universe_killmail` table — a persistent cache of full ESI killmails feeding the system-killboard module.
**File:** `src/db/schema/universe/killmail.ts`

---

### universeKillmail
`pgTable('universe_killmail', …)`:
- `killmail_id` — `bigint` PK, the natural EVE killmail id (not generated). Exposed as `id` on the TS side.
- `hash` — `text`, not null. The killmail hash paired with the id for the `getKillmail` fetch.
- `body` — `jsonb`, not null. The raw decoded ESI killmail body.
- `killmail_time` — `timestamptz`, not null, indexed (`universe_killmail_killmail_time_idx`). Extracted from the body; the retention key.
- `fetched_at` — `timestamptz`, default `now()`.

### Notes
- **Immutable cache.** Killmail bodies never change, so a cached row is authoritative forever and is never re-fetched — the cache-aside in `src/lib/map/killboard.ts` only fetches ids absent from this table.
- **No FK to `universe_system`.** A kill can reference a system the SDE snapshot lacks; the solar-system id is validated at the boundary only.
- **Retention.** Bounded by the `killmail-cleanup` cron (`src/lib/jobs/tasks/killmailCleanup.ts`), which deletes rows older than `KILLMAIL_CACHE_RETENTION_DAYS` by `killmail_time`. Not partitioned — a simple indexed reaper suffices for the expected volume.
