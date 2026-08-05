import type { CronItem, Task, TaskList } from 'graphile-worker';
import { activityRollupRefresh } from './tasks/activityRollupRefresh';
import { characterCleanup } from './tasks/characterCleanup';
import { csvIngest } from './tasks/csvIngest';
import { eolExpiry } from './tasks/eolExpiry';
import { expiredConnections } from './tasks/expiredConnections';
import { incursionRefresh } from './tasks/incursionRefresh';
import { killmailCleanup } from './tasks/killmailCleanup';
import { locationPoll } from './tasks/locationPoll';
import { mapPurge } from './tasks/mapPurge';
import { metricsSnapshot } from './tasks/metricsSnapshot';
import { partitionMaintenance } from './tasks/partitionMaintenance';
import { sdeIngest } from './tasks/sdeIngest';
import { sdeRefresh } from './tasks/sdeRefresh';
import { signatureReap } from './tasks/signatureReap';
import { sovFwRefresh } from './tasks/sovFwRefresh';
import { systemStatsRefresh } from './tasks/systemStatsRefresh';
import { webhookDispatch } from './tasks/webhookDispatch';

/**
 * The registry every task module is bound to. Each `JobModule` exports
 * `{ name, cron?, run }`; this file imports them and indexes:
 *
 *   - `tasks`     — graphile-worker `TaskList` (`{ [name]: run }`)
 *   - `cronItems` — graphile-worker `CronItem[]` (one entry per cron-driven task)
 *
 * Sub-stages 11.2–11.6 add new task modules to the `modules` list below; the
 * derived `tasks` / `cronItems` exports update automatically.
 *
 * No directory-based task loading (`taskDirectory`) on purpose — explicit
 * imports keep the registry greppable and ESM-friendly under `tsx`.
 */
export interface JobModule {
  /** graphile-worker task identifier (e.g. `'signature-reap'`). Globally unique. */
  name: string;
  /**
   * Cron expression (5-field graphile-worker syntax). Omit for tasks
   * scheduled by `addJob` rather than cron.
   */
  cron?: string;
  /**
   * Named graphile-worker queue (see `queues.ts`). Jobs sharing a queue run
   * strictly one at a time. Omit for tasks that may run concurrently.
   */
  queue?: string;
  /** Instrumented handler — typically the return value of `withInstrumentation(name, raw)`. */
  run: Task;
}

const modules: readonly JobModule[] = [
  // Map housekeeping (signature reap, EOL/expired connections, map purge).
  signatureReap,
  eolExpiry,
  expiredConnections,
  mapPurge,
  // Per-system stats refresh from ESI.
  systemStatsRefresh,
  sovFwRefresh,
  // Active-incursion feed from ESI (5-min ESI cache).
  incursionRefresh,
  // Age-by-kill-time retention reaper for the universe_killmail cache.
  killmailCleanup,
  // Activity-log materialized-view refresh.
  activityRollupRefresh,
  // pg_partman maintenance (premake + retention).
  partitionMaintenance,
  // Observability snapshot: registry + gauges → ap_metric_snapshot for the admin graphs.
  metricsSnapshot,
  // ESI cannot return other corps' structures, so structure intel is manual
  // entry (`ap_structure`) with no recurring resolve work.
  // Per-character location poll (no cron; self-re-enqueueing).
  locationPoll,
  // Per-event Discord webhook dispatch (no cron; enqueued by commitMapEvent).
  webhookDispatch,
  // Kick expiry + periodic authz resync.
  characterCleanup,
  // On-demand SDE refresh, enqueued by the setup wizard.
  sdeIngest,
  // On-demand vendored-CSV refresh, enqueued by the setup wizard's dedicated card.
  csvIngest,
  // Daily check for a newer published SDE build; ingests it through the
  // sde-ingest child-process path when found.
  sdeRefresh,
];

export function jobModules(): readonly JobModule[] {
  return modules;
}

/**
 * The subset of jobs the `/setup` ops console may enqueue on-demand with an
 * empty payload. Restricted to cron-driven tasks: those run unattended on a
 * schedule and therefore take no required payload, so an empty `'{}'` enqueue
 * is always valid. Payload-driven `addJob`-only tasks (`location-poll`,
 * `webhook-dispatch`) are excluded — enqueuing them payload-less crashes the
 * handler. `sde-ingest` and `csv-ingest` are also payload-less but have their
 * own dedicated console cards, so they aren't surfaced in the generic list.
 */
export function onDemandJobModules(): readonly JobModule[] {
  return modules.filter((m) => m.cron !== undefined);
}

export function buildTaskList(extra: readonly JobModule[] = []): TaskList {
  const out: TaskList = {};
  for (const m of [...modules, ...extra]) {
    if (out[m.name]) throw new Error(`duplicate job name '${m.name}' in registry`);
    out[m.name] = m.run;
  }
  return out;
}

export function buildCronItems(extra: readonly JobModule[] = []): CronItem[] {
  const out: CronItem[] = [];
  for (const m of [...modules, ...extra]) {
    if (!m.cron) continue;
    out.push({
      task: m.name,
      match: m.cron,
      identifier: m.name,
      ...(m.queue ? { options: { backfillPeriod: 0, queueName: m.queue } } : {}),
    });
  }
  return out;
}

/**
 * The named queue a task is registered under, or `null` for an unqueued task.
 * Callers enqueuing by task name (the `/setup` console) resolve the queue here
 * so an on-demand run lands under the same mutual exclusion as its cron.
 */
export function jobQueueFor(taskName: string): string | null {
  return modules.find((m) => m.name === taskName)?.queue ?? null;
}
