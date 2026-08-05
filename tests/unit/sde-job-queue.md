## sde-job-queue.test.ts

**Purpose:** Guards the mutual exclusion of the three static-data tasks — that `sde-ingest`, `sde-refresh`, and `csv-ingest` are registered on one shared graphile-worker queue, and that both job-creation paths carry it.
**File:** `tests/unit/sde-job-queue.test.ts`

### Running
No database and no mocks — imports the real registry and asserts over its derived exports.

```
pnpm test sde-job-queue
```

### Cases
- All three static-data modules declare `queue === SDE_QUEUE`.
- `jobQueueFor` resolves that queue by task name, the path the `/setup` console enqueues through.
- A task with no declared queue resolves to `null`, as does an unknown name.
- `buildCronItems` puts `options.queueName` on the `sde-refresh` cron item and leaves it off an unqueued one.

### Depends On
- `buildCronItems`, `jobModules`, `jobQueueFor` ([[registry]]), `SDE_QUEUE` ([[queues]]).
