## eolExpiry.ts

**Purpose:** Cron task that hard-deletes wormhole connections whose end-of-life timer has elapsed (`eol_stage <> 'none' AND eol_at < now() - <per-stage lifetime>`) on maps that opt in via `ap_map.delete_eol_connections`.
**File:** `src/lib/jobs/tasks/eolExpiry.ts`

---

### eolExpiry: JobModule
- `name`: `'eol-expiry'`
- `cron`: `'*/5 * * * *'` (every 5 minutes).
- `run`: `withInstrumentation('eol-expiry', expireEol)`.

### expireEol(): { scanned, deleted, failed }
Selects up to `JOB_DELETE_BATCH_SIZE` rows from `ap_map_connection` joined with `ap_map`, filtered by `eol_stage <> 'none'`, `eol_at IS NOT NULL`, `eol_at < now() - <per-stage lifetime>`, `ap_map.delete_eol_connections = true`, `ap_map.deleted_at IS NULL`. The per-stage lifetime is chosen in SQL with a `CASE`: `WORMHOLE_EOL_CRITICAL_LIFETIME_MS` (1h15m) for the `critical` stage, else `WORMHOLE_EOL_LIFETIME_MS` (4h15m) — the same constants the canvas countdown reads, kept as ms per the project convention and converted to seconds at the `make_interval` site. A **15% margin** is applied to both thresholds (`× 1.15`) to account for wormhole lifetime variance (estimated ±15%); the optimistic assumption is that holes last as long as possible, so reaping is delayed to the upper bound. For each, fires `commitMapEvent({ kind: 'connection.delete', characterId: null })` — the delete's `RETURNING` carries the endpoint `ap_map_system.id`s (`source`/`target`) into the payload so the audit/Discord name the collapsed hole, and the trigger broadcasts the disappearance so client tabs drop the edge live. Attached `ap_map_signature` rows cascade-delete with the connection.

Counts land in `ap_job_run.notes`.

### Notes
- The `eol_at IS NOT NULL` guard skips the race where a writer leaves the `none` stage but is mid-transaction on `eol_at`. The mutation core stamps both together (`connections.ts` `updateConnection`), so this is purely defensive.
- Each per-row erase is recorded as an `ap_map_event` insert from `commitMapEvent`.
