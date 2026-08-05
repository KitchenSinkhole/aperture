## registry.ts

**Purpose:** Central registry of graphile-worker task modules. Builds the `TaskList` and `CronItem[]` consumed by `runner.ts`.
**File:** `src/lib/jobs/registry.ts`

---

### interface JobModule
What each task file under `src/lib/jobs/tasks/` exports.

- `name` - graphile-worker task identifier; globally unique.
- `cron` - optional 5-field cron expression. Omit for tasks scheduled by `addJob` rather than cron.
- `queue` - optional named graphile-worker queue ([[queues]]). Jobs sharing a queue run strictly one at a time. Omit for tasks that may run concurrently.
- `run` - the graphile-worker `Task` handler. Should be wrapped in `withInstrumentation(name, raw)` so every invocation lands in `ap_job_run`.

### jobModules(): readonly JobModule[]
The full registered set. Exposed primarily for operability pages and CLI scripts.

### onDemandJobModules(): readonly JobModule[]
The subset the `/setup` ops console may enqueue with an empty payload — `modules.filter((m) => m.cron !== undefined)`. Cron-driven tasks take no required payload, so a payload-less enqueue is always valid. Payload-driven `addJob`-only tasks (`location-poll`, `webhook-dispatch`) are excluded because enqueuing them empty crashes the handler; `sde-ingest` and `csv-ingest` are payload-less but have their own dedicated console cards.

### buildTaskList(extra?): TaskList
Builds the graphile-worker `TaskList` map (`{ [name]: run }`) from the registry. Throws on duplicate task names.

### buildCronItems(extra?): CronItem[]
Builds graphile-worker cron items for modules whose `cron` is set. The identifier is the task name for stable de-duplication. A module with a `queue` gets `options.queueName` so its cron-scheduled job lands under the same mutual exclusion as an on-demand enqueue.

### jobQueueFor(taskName: string): string | null
The named queue the task is registered under, or `null` when it has none. Callers enqueuing by name (the `/setup` console) resolve the queue here rather than hard-coding it.

**Parameters:**
- `taskName` — graphile-worker task identifier.

**Returns:** The queue name to pass as `add_job`'s `queue_name`.

### Notes
- No `taskDirectory` - explicit imports keep wiring greppable and TypeScript-checked.
- Per-task cron expressions live on each task module.
- Registers `sov-fw-refresh`, the hourly sovereignty / faction-warfare ESI refresh task.
- Registers `incursion-refresh`, the 5-minute active-incursion ESI refresh task.
- Registers `webhook-dispatch`, a non-cron task enqueued by `commitMapEvent` per `ap_map_event` insert on maps with at least one configured Discord webhook.
- Registers `character-cleanup`, the 5-minute cron that clears expired kicks and resyncs stale `authz_level` rows against ESI.
- Registers `sde-ingest`, a non-cron task wrapping `runIngest` so the setup wizard can re-run the static-data pipeline against the build the database holds on-demand.
- Registers `csv-ingest`, a non-cron task wrapping `runCsvIngest` so the setup wizard can re-ingest the vendored wormhole CSVs (statics/overrides/classes) without re-running the full SDE ingest.
- Registers `sde-refresh`, the daily 12:15 UTC cron that checks CCP's published SDE build against `ap_sde_state` and ingests a newer one through the same isolated child-process path as `sde-ingest`.
- Registers `metrics-snapshot`, the 1-minute cron that samples the metric registry + gauges into `ap_metric_snapshot` for the admin metrics page's history graphs.
- Registers `killmail-cleanup`, the daily cron that deletes `universe_killmail` cache rows older than `KILLMAIL_CACHE_RETENTION_DAYS` by kill time.
- ESI cannot return other corps' structures, so structure intel is manual entry (`ap_structure`) with no recurring resolve job.
