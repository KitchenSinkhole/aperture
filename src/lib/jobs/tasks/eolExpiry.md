## eolExpiry.ts

**Purpose:** Cron task that hard-deletes wormhole connections whose end-of-life timer has elapsed (`eol_stage <> 'none' AND eol_at < now() - <per-stage lifetime>`) on maps that opt in via `ap_map.delete_eol_connections`.
**File:** `src/lib/jobs/tasks/eolExpiry.ts`

---

### eolExpiry: JobModule
- `name`: `'eol-expiry'`
- `cron`: `'*/5 * * * *'` (every 5 minutes).
- `run`: `withInstrumentation('eol-expiry', expireEol)`.

### expireEol(): { scanned, deleted, failed }
Selects up to `JOB_DELETE_BATCH_SIZE` rows from `ap_map_connection` joined with `ap_map`, filtered by `eol_stage <> 'none'`, `eol_at IS NOT NULL`, `eol_at < now() - <per-stage lifetime>`, `ap_map.delete_eol_connections = true`, `ap_map.deleted_at IS NULL`. The per-stage lifetime is chosen in SQL with a `CASE`: `WORMHOLE_EOL_CRITICAL_LIFETIME_MS` (1h15m) for `critical`, `WORMHOLE_EXPIRED_LIFETIME_MS` (4h) for the manual `expired` stage, else `WORMHOLE_EOL_LIFETIME_MS` (4h36m) for `eol` — kept as ms per the project convention and converted to seconds at the `make_interval` site. `expired` is measured from `eol_at` (when a scout flagged it) and is deliberately generous so the row is only purged once the hole is near-certainly collapsed in-game. For each, fires `commitMapEvent({ kind: 'connection.delete', characterId: null })`. Inside that transaction it first reads `readConnectionDeathSnapshot` with cause `eol_reaped` (before the delete, since the mass log and bound signatures cascade with the row), then deletes only if the row still meets the reap condition under that lock, so a scout's confirm or clear since the select keeps the hole; the payload carries the endpoint `ap_map_system.id`s (`source`/`target`) so the audit/Discord name the collapsed hole, plus the full death snapshot. A row gone or no longer due since the candidate select rolls back and counts as `failed`. The trigger broadcasts the disappearance so client tabs drop the edge live. Attached `ap_map_signature` rows cascade-delete with the connection.

Counts land in `ap_job_run.notes`.

### Notes
- The `eol_at IS NOT NULL` guard skips the race where a writer leaves the `none` stage but is mid-transaction on `eol_at`. The mutation core stamps both together (`connections.ts` `updateConnection`), so this is purely defensive.
- Each per-row erase is recorded as an `ap_map_event` insert from `commitMapEvent`.
