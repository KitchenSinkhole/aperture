## withInstrumentation.ts

**Purpose:** Higher-order wrapper that records every graphile-worker task handler invocation in `ap_job_run` (observability).
**File:** `src/lib/jobs/withInstrumentation.ts`

---

### withInstrumentation<TPayload>(name, run): Task
Wraps a raw handler so each invocation:

1. INSERTs a row into `ap_job_run` with `name` + `started_at = now()` and captures `id`.
2. Awaits `run(payload, helpers)`.
3. On success: records `recordJobRun(name, 'success', durationMs)` (`job_runs_total{task,outcome}` + `job_duration_ms{task}`), then updates the row with `ended_at = now()`, `success = true`, `notes = <JSON-coerced return>`.
4. On failure: records `recordJobRun(name, 'failure', durationMs)`, updates the row with `ended_at = now()`, `success = false`, `error_text = <truncated message>`, then **re-throws** so graphile-worker handles retry/backoff.

`durationMs` is the `performance.now()` span around the inner `run()`.

**Parameters:**
- `name` — graphile-worker task identifier (must match the `JobModule.name` / cron `task` field).
- `run` — the inner handler. Receives the cron payload + `JobHelpers`; may return any JSON-serialisable value for the `notes` field, or `void`.

**Returns:** A `Task` ready to drop into the registry / `TaskList`.

**Caps:**
- `apertureConfig.JOB_INSTRUMENTATION_ERROR_MAX_LENGTH` — truncates very large `Error.message` strings.
- `apertureConfig.JOB_INSTRUMENTATION_NOTES_MAX_BYTES` — oversize `notes` JSON is replaced with `{ truncated: true, originalLength: N }` instead of dropped, so the row still records the size signal.

**Non-serialisable returns** (functions, raw bigints) are stored as `null` rather than failing the row write.

### Notes
- The row write uses the app's drizzle `db` client, **not** `helpers.withPgClient` — the run row is intentionally outside the graphile-worker job transaction so it survives a handler crash mid-transaction.
- Operators inspecting `ap_job_run` see in-flight handlers as `ended_at IS NULL`. A worker that dies mid-handler will leave such a row; the operability sweep reports those as "abandoned".
