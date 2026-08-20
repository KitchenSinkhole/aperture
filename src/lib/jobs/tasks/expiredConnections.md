## expiredConnections.ts

**Purpose:** Cron task that hard-deletes wormhole and abyssal connections older than the practical lifetime cap (`scope IN ('wh', 'abyssal') AND created_at < now() - WORMHOLE_DEFAULT_LIFETIME_MS`) on maps that opt in via `ap_map.delete_expired_connections`.
**File:** `src/lib/jobs/tasks/expiredConnections.ts`

---

### expiredConnections: JobModule
- `name`: `'expired-connections'`
- `cron`: `'0 * * * *'` (hourly).
- `run`: `withInstrumentation('expired-connections', expire)`.

### expire(): { scanned, deleted, failed }
Selects up to `JOB_DELETE_BATCH_SIZE` rows from `ap_map_connection` joined with `ap_map`, filtered by `scope IN ('wh', 'abyssal')`, `created_at < now() - 172800s` (`WORMHOLE_DEFAULT_LIFETIME_MS / 1000` = 48h — same constant the canvas "expires in X" hint reads, kept as ms per the project convention and converted to seconds at the SQL `make_interval` site), `ap_map.delete_expired_connections = true`, `ap_map.deleted_at IS NULL`. For each, fires `commitMapEvent({ kind: 'connection.delete', characterId: null })`; the delete's `RETURNING` carries the endpoint `ap_map_system.id`s (`source`/`target`) into the payload so the audit/Discord can name the collapsed hole. `stargate` and `jumpbridge` are structural and never expire on age alone. Abyssal traces share the wormhole threshold rather than modelling the filament's own minutes-long life; the reap is what bounds a map that folds filament runs, since nothing else removes those edges.

Counts land in `ap_job_run.notes`.

### Notes
- 48h is the absolute maximum a wormhole can stay open in EVE; the cron is the safety net for wormholes that collapsed off-screen and never got marked.
- Distinct from `eolExpiry`: that one is about the EOL-stage timer (4h 15m after the `eol` stage / 1h 15m after the `critical` stage was entered); this one is about absolute age regardless of EOL stage.
