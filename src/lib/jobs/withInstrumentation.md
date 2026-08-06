## withInstrumentation.ts

**Purpose:** Higher-order wrapper that records every graphile-worker task handler invocation in `ap_job_run` (observability).
**File:** `src/lib/jobs/withInstrumentation.ts`

---

### withInstrumentation<TPayload>(name, run, opts?): Task
Wraps a raw handler in one of two write modes. `recordJobRun(name, outcome, durationMs)` (`job_runs_total{task,outcome}` + `job_duration_ms{task}`) fires on **every** invocation in both modes and is the sampling-immune source of truth; `durationMs` is the `performance.now()` span around the inner `run()`.

**Full-fidelity mode** (default, `successSampleRate` absent or ≤ 1):
1. INSERTs a row into `ap_job_run` with `name` + `started_at = now()` and captures `id`.
2. Awaits `run(payload, helpers)`.
3. On success: updates the row with `ended_at = now()`, `success = true`, `notes = <JSON-coerced return>`.
4. On failure: updates the row with `ended_at = now()`, `success = false`, `error_text = <truncated message>`, then **re-throws** so graphile-worker handles retry/backoff.

**Sampled mode** (`successSampleRate = N > 1`, for high-frequency writers like `location-poll`): no in-flight row is written. On success, a single completed row (`weight = N`) is inserted only ~1-in-`N`; on failure, a single completed row (`weight = 1`) is always inserted, then **re-throws**. `started_at` is the handler's real start time.

**Parameters:**
- `name` — graphile-worker task identifier (must match the `JobModule.name` / cron `task` field).
- `run` — the inner handler. Receives the cron payload + `JobHelpers`; may return any JSON-serialisable value for the `notes` field, or `void`.
- `opts.successSampleRate` — 1-in-N success sampling for high-frequency tasks; every failure is still persisted.

**Returns:** A `Task` ready to drop into the registry / `TaskList`.

**Error rendering:** `error_text` is the error's `cause` chain rendered innermost-first, joined by ` <- `. Each link contributes its message plus any `node-postgres` diagnostics it carries (`SQLSTATE <code>`, `constraint <name>`, `DETAIL`). Innermost-first matters because a Drizzle wrapper's own message is the whole failed statement plus every bound parameter, so the length cap truncates the wrapper rather than the diagnosis.

**Caps:**
- `apertureConfig.JOB_INSTRUMENTATION_ERROR_MAX_LENGTH` — truncates the rendered error, keeping the innermost cause.
- `apertureConfig.JOB_INSTRUMENTATION_NOTES_MAX_BYTES` — oversize `notes` JSON is replaced with `{ truncated: true, originalLength: N }` instead of dropped, so the row still records the size signal.

**Non-serialisable returns** (functions, raw bigints) are stored as `null` rather than failing the row write.

### Notes
- The row write uses the app's drizzle `db` client, **not** `helpers.withPgClient` — the run row is intentionally outside the graphile-worker job transaction so it survives a handler crash mid-transaction.
- Operators inspecting `ap_job_run` see in-flight full-fidelity handlers as `ended_at IS NULL`. A worker that dies mid-handler leaves such a row; the operability sweep reports those as "abandoned", and `closeOrphanedJobRuns` ([[runner]]) clears them on the next boot. Sampled tasks write no in-flight row, so they never contribute to the abandoned count.
