## autoEol.ts

**Purpose:** Cron task that marks a never-EOL'd wormhole `eol_stage = 'eol'`, `eol_source = 'auto'` once it nears its type's catalogued lifetime, on maps that opt in via `ap_map.auto_eol_connections`.
**File:** `src/lib/jobs/tasks/autoEol.ts`

No `server-only` anywhere in its import graph: it runs in the bare-tsx worker.

---

### autoEol: JobModule
- `name`: `'auto-eol'`
- `cron`: `'*/5 * * * *'` (every 5 minutes).
- `run`: `withInstrumentation('auto-eol', markAutoEol)`.

### markAutoEol(): { scanned, marked, failed, unresolvedAttribute? }
Resolves the dogma attribute `wormholeMaxStableTime` (minutes) by name from `universe_dogma_attribute`. When it is missing, marks nothing and returns `unresolvedAttribute: 'wormholeMaxStableTime'` in the notes.

Otherwise selects up to `JOB_DELETE_BATCH_SIZE` connections, oldest first, that are:
- on a map with `auto_eol_connections = true` and `deleted_at IS NULL`;
- `scope = 'wh'`, `eol_stage = 'none'`, `eol_source IS NULL` (never staged, or a human EOL since undone; a cleared estimate reads `observed`), `confirmed_at IS NOT NULL` (not dormant);
- past `created_at + nominal − WORMHOLE_EOL_NOMINAL_MS`.

**Nominal lifetime**, read through `universe_type_attribute_effective`:
- **Bound type:** `boundWormholeCodeSql` over the `universe_wormhole` names of the `ap_map_signature` rows bound to the connection. A single non-K162 code gives that type's lifetime.
- **Static fallback:** when no code resolves (no typed sig, or disagreeing codes, which only a mistyped sig produces) and `is_static` is set, the source system's `universe_system_static` whose `target_class` equals the target system's `universe_system.security`, only when exactly one static matches.
- K162-only, untyped non-static, a typed code with no lifetime value, and ambiguous statics are never marked.

Each candidate gets its own `commitMapEvent({ kind: 'connection.update', characterId: null })`. Inside it a conditional `UPDATE` (still `eol_stage = 'none'`, `eol_source IS NULL`, `confirmed_at IS NOT NULL`) sets `('eol', 'auto')` and `eol_at = now()`; a row that no longer qualifies (a scout wrote it since the select) rolls back and counts as `failed`. The payload carries `eolStage: 'eol'`, `eolAt`, `eolSource: 'auto'` and the endpoint `source`/`target` `ap_map_system` ids.

Counts land in `ap_job_run.notes`.

### Notes
- `eol_at` is the mark time, not the estimated EOL entry time, so an estimate shows for the full `eol` reap clock before `eolExpiry` can take it, however late the map opted in or the sig was typed.
- `updated_at` is not touched: it feeds the death snapshot's `lastAliveAt`, and an estimate is not a sighting.
- The audit log files the event under automation and describes it as an estimate; the webhook dispatcher never posts it (`isEolEstimateEvent`).

### Depends On
- `boundWormholeCodeSql` (`src/lib/map/connectionDeathSnapshot.ts`) — the shared bound-signature code rule.
- `commitMapEvent` (`src/lib/map/mutations/core.ts`).
- `apertureConfig.WORMHOLE_EOL_NOMINAL_MS`, `apertureConfig.JOB_DELETE_BATCH_SIZE`.
