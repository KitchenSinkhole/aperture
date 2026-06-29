import { and, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../aperture.config';
import { db, pool } from '@/db/client';
import { apErrorLog, apJobRun } from '@/db/schema';
import { openBreakerCount } from '@/lib/esi/breaker';
import { postDiscordWebhook } from '@/lib/integrations/discord';
import { latestFinishedRun } from '@/lib/jobs/queries';
import { getLogger } from '@/lib/log/logger';
import { env } from '@/lib/env';
import { evaluateRules, formatTransition, reconcile } from './rules';
import type { AlertSignals, AlertTransition } from '@/types';

/**
 * The IO shell for Phase 6 instance alerting: an in-process `setInterval` loop
 * booted from `server.ts` (NOT graphile-worker) so scheduling survives a
 * degraded DB — the very thing alerting must report on. Each tick gathers
 * timeout-guarded signals, runs the pure rules + dedup state machine
 * (`rules.ts`), and pushes transitions to Discord over HTTP (no DB needed to
 * deliver).
 *
 * No `server-only` import: this module is loaded under `tsx` by `server.ts`.
 */

const log = getLogger('server');

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/**
 * Start the alert loop. No-ops if already running or if neither alert webhook is
 * configured (nothing to deliver to). The interval timer is `unref`'d so it
 * never keeps the process alive on its own.
 */
export function startAlertLoop(): void {
  if (timer) return;
  if (!env.ALERT_WEBHOOK_URL && !env.STATUS_WEBHOOK_URL) return;
  timer = setInterval(() => void tick(), apertureConfig.ALERT_EVALUATE_INTERVAL_MS);
  timer.unref?.();
}

/** Stop the alert loop. Idempotent. */
export function stopAlertLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function isAlertLoopRunning(): boolean {
  return timer !== null;
}

/** One evaluation tick. Never throws; a re-entrancy guard skips overlapping runs. */
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const signals = await gatherSignals();
    const transitions = reconcile(evaluateRules(signals));
    for (const transition of transitions) await dispatch(transition);
  } catch (err) {
    log.error('alert tick failed', { err: err instanceof Error ? err.message : String(err) });
  } finally {
    ticking = false;
  }
}

/**
 * Gather every signal the rules read. Each DB-backed source is independently
 * timeout-guarded so a hung DB never wedges the loop; a failure leaves the field
 * `null` so the corresponding rule degrades to `unknown` (no-op) rather than a
 * false `ok`. The DB probe failing is itself the `db` rule's alert signal.
 */
async function gatherSignals(): Promise<AlertSignals> {
  const [dbProbeMs, workerStaleMs, abandonedJobs, recentErrors] = await Promise.all([
    probeDb(),
    probeWorkerStaleMs(),
    probeAbandonedJobs(),
    probeRecentErrors(),
  ]);
  return {
    dbProbeMs,
    workerStaleMs,
    abandonedJobs,
    recentErrors,
    openBreakers: openBreakerCount(), // in-process, always available
  };
}

/** Race a thenable against a timeout; the timer is `unref`'d so it can't pin the process. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      timer.unref?.();
    }),
  ]);
}

async function probeDb(): Promise<number | null> {
  const start = Date.now();
  try {
    await withTimeout(pool.query('SELECT 1'), apertureConfig.ALERT_DB_PROBE_TIMEOUT_MS);
    return Date.now() - start;
  } catch {
    return null;
  }
}

async function probeWorkerStaleMs(): Promise<number | null> {
  try {
    const last = await withTimeout(latestFinishedRun(), apertureConfig.ALERT_DB_PROBE_TIMEOUT_MS);
    // No run has ever finished → indistinguishable from a fresh boot, so stay
    // `unknown` rather than false-alarming until the first job completes.
    if (!last) return null;
    return Date.now() - last.endedAt.getTime();
  } catch {
    return null;
  }
}

async function probeAbandonedJobs(): Promise<number | null> {
  try {
    const cutoff = sql`now() - make_interval(secs => ${Math.round(apertureConfig.ALERT_JOB_ABANDONED_MS / 1000)})`;
    const rows = await withTimeout(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(apJobRun)
        .where(and(isNull(apJobRun.endedAt), lt(apJobRun.startedAt, cutoff))),
      apertureConfig.ALERT_DB_PROBE_TIMEOUT_MS,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}

async function probeRecentErrors(): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - apertureConfig.ALERT_ERROR_RATE_WINDOW_MS);
    const rows = await withTimeout(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(apErrorLog)
        .where(and(gte(apErrorLog.occurredAt, cutoff), inArray(apErrorLog.level, ['error', 'fatal']))),
      apertureConfig.ALERT_DB_PROBE_TIMEOUT_MS,
    );
    return rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}

/**
 * Push a transition to whichever webhooks are configured. State has already been
 * mutated by `reconcile`, so a delivery failure does not re-fire next tick — it
 * is logged (best-effort; the log write itself may fail if the DB is down, which
 * is fine). `postDiscordWebhook` never throws.
 */
async function dispatch(transition: AlertTransition): Promise<void> {
  const { status, operator } = formatTransition(transition);
  const sends: Promise<{ ok: boolean; status?: number; error?: string }>[] = [];
  if (env.STATUS_WEBHOOK_URL) sends.push(postDiscordWebhook(env.STATUS_WEBHOOK_URL, status));
  if (env.ALERT_WEBHOOK_URL) sends.push(postDiscordWebhook(env.ALERT_WEBHOOK_URL, operator));
  const results = await Promise.all(sends);
  for (const result of results) {
    if (!result.ok) {
      log.error('alert webhook delivery failed', {
        rule: transition.key,
        kind: transition.kind,
        status: result.status,
        error: result.error,
      });
    }
  }
}
