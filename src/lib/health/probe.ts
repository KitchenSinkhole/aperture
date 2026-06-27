import { apertureConfig } from '../../../aperture.config';
import { pool } from '@/db/client';
import { openBreakerCount } from '@/lib/esi/breaker';
import { latestFinishedRun } from '@/lib/jobs/queries';
import { bus } from '@/lib/realtime/bus';
import journal from '@/db/migrations/meta/_journal.json';
import type {
  HealthComponent,
  HealthComponentName,
  HealthComponentStatus,
  HealthReport,
} from '@/types';

/**
 * Read-only health probes behind `/api/health` (shallow) and
 * `/api/health/ready` (deep). No `server-only` import — this module must be safe
 * to load from any runtime (and is reused by alerting later).
 */

/** Ranks statuses so the overall report is the worst component. Only `down` 503s. */
const SEVERITY: Record<HealthComponentStatus, number> = {
  ok: 0,
  unknown: 1,
  degraded: 1,
  down: 2,
};

// drizzle's migrator stores each applied migration's `created_at` as the
// journal entry's `when` (epoch ms), so the latest journal `when` is the newest
// migration the deployed code expects to be applied.
const journalEntries = journal.entries as { when: number; tag: string }[];
const latestJournalWhen = journalEntries.reduce((max, e) => Math.max(max, e.when), 0);
const latestJournalTag =
  journalEntries.find((e) => e.when === latestJournalWhen)?.tag ?? 'unknown';

/**
 * Cheap liveness check for the external monitor: a single `SELECT 1`.
 *
 * **Returns:** `true` if the DB answered, `false` on any failure.
 */
export async function shallowHealth(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep readiness report: probes db, realtime bus, worker, ESI breakers, and
 * migrations, then folds them into an overall status (worst component).
 *
 * **Returns:** a `HealthReport`; the caller 503s iff `status === 'down'`.
 */
export async function deepHealth(): Promise<HealthReport> {
  const [db, worker, migrations] = await Promise.all([
    checkDb(),
    checkWorker(),
    checkMigrations(),
  ]);

  const components: Record<HealthComponentName, HealthComponent> = {
    db,
    realtimeBus: checkRealtimeBus(),
    worker,
    esi: checkEsi(),
    migrations,
  };

  const status = (Object.values(components) as HealthComponent[]).reduce<HealthComponentStatus>(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'ok',
  );

  return { status, checkedAt: new Date().toISOString(), components };
}

async function checkDb(): Promise<HealthComponent> {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  } catch {
    return { status: 'down', detail: 'Database unreachable.' };
  }
}

function checkRealtimeBus(): HealthComponent {
  // A bus with no subscribers is intentionally disconnected (lazy connect), not
  // unhealthy — only flag degraded when subscribers exist but the LISTEN dropped.
  if (bus.isHealthy() || bus.subscriberCount() === 0) return { status: 'ok' };
  return { status: 'degraded', detail: 'Realtime LISTEN connection down.' };
}

async function checkWorker(): Promise<HealthComponent> {
  try {
    const last = await latestFinishedRun();
    if (!last) return { status: 'down', detail: 'No job has ever finished.' };
    const ageMs = Date.now() - last.endedAt.getTime();
    if (ageMs > apertureConfig.HEALTH_WORKER_STALE_MS) {
      return { status: 'down', detail: `No job finished in ${Math.round(ageMs / 1000)}s.` };
    }
    return { status: 'ok', detail: last.name };
  } catch {
    return { status: 'down', detail: 'Worker liveness query failed.' };
  }
}

function checkEsi(): HealthComponent {
  const open = openBreakerCount();
  if (open === 0) return { status: 'ok' };
  return { status: 'degraded', detail: `${open} ESI breaker(s) open.` };
}

async function checkMigrations(): Promise<HealthComponent> {
  try {
    const { rows } = await pool.query<{ last_created: string | null }>(
      'SELECT max(created_at) AS last_created FROM drizzle.__drizzle_migrations',
    );
    const lastApplied = rows[0]?.last_created != null ? Number(rows[0].last_created) : null;
    if (lastApplied == null) return { status: 'down', detail: 'No migrations applied.' };
    if (lastApplied < latestJournalWhen) {
      return { status: 'down', detail: `Pending migrations (latest available: ${latestJournalTag}).` };
    }
    return { status: 'ok', detail: latestJournalTag };
  } catch {
    return { status: 'down', detail: 'Migrations table unreadable.' };
  }
}
