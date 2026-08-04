import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apJobRun, apSdeState } from '@/db/schema';
import type { ApSdeState } from '@/types';
import { getInstanceConfig } from '@/lib/auth/instanceConfig';
import { readSetupCookie } from '@/lib/auth/setup-cookie';
import { onDemandJobModules } from '@/lib/jobs/registry';
import {
  InstanceAccessPanel,
  type SerializedInstanceConfig,
} from '@/components/setup/InstanceAccessPanel';
import { RunCronCard } from '@/components/setup/RunCronCard';
import { RunCsvIngestCard } from '@/components/setup/RunCsvIngestCard';
import { RunMigrationsCard } from '@/components/setup/RunMigrationsCard';
import { RunSdeIngestCard } from '@/components/setup/RunSdeIngestCard';
import { RunSdeRefreshCard } from '@/components/setup/RunSdeRefreshCard';
import { SetupUnlockForm } from '@/components/setup/SetupUnlockForm';
import { setupLogoutAction } from '@/app/(setup)/actions';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

interface RecentRun {
  id: string;
  name: string;
  startedAt: Date;
  endedAt: Date | null;
  success: boolean | null;
}

interface StatusSummary {
  recentRuns: RecentRun[];
  latestMigration: string | null;
  recentEventCount: number;
}

async function loadStatus(): Promise<StatusSummary> {
  const recentRows = await db
    .select({
      id: apJobRun.id,
      name: apJobRun.name,
      startedAt: apJobRun.startedAt,
      endedAt: apJobRun.endedAt,
      success: apJobRun.success,
    })
    .from(apJobRun)
    .orderBy(desc(apJobRun.startedAt))
    .limit(20);

  let latestMigration: string | null = null;
  try {
    const row = await db.execute<{ created_at: number | string | null }>(
      sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`,
    );
    const created = row.rows[0]?.created_at ?? null;
    if (created !== null) latestMigration = String(created);
  } catch {
    latestMigration = null;
  }

  let recentEventCount = 0;
  try {
    const row = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM ap_map_event WHERE occurred_at >= now() - interval '1 hour'`,
    );
    recentEventCount = Number(row.rows[0]?.count ?? 0);
  } catch {
    recentEventCount = 0;
  }

  return {
    recentRuns: recentRows.map((r) => ({
      id: r.id.toString(),
      name: r.name,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      success: r.success,
    })),
    latestMigration,
    recentEventCount,
  };
}

async function loadSdeState(): Promise<ApSdeState | null> {
  try {
    const [row] = await db.select().from(apSdeState).where(eq(apSdeState.id, 1));
    return row ?? null;
  } catch {
    // Table not migrated yet on a fresh DB.
    return null;
  }
}

async function loadInstanceAccess(): Promise<SerializedInstanceConfig> {
  try {
    const config = await getInstanceConfig();
    return {
      accessMode: config.accessMode,
      updatedAt: config.updatedAt?.toISOString() ?? null,
      owners: config.owners.map((o) => ({
        principalKind: o.principalKind,
        principalId: o.principalId.toString(),
      })),
      grants: config.grants.map((g) => ({
        id: g.id.toString(),
        principalKind: g.principalKind,
        principalId: g.principalId.toString(),
        capability: g.capability,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        note: g.note,
      })),
    };
  } catch {
    // Tables not migrated yet on a fresh DB — show the locked-down default so
    // the operator can run migrations first, then revisit.
    return { accessMode: 'restricted', updatedAt: null, owners: [], grants: [] };
  }
}

export default async function SetupPage() {
  const unlocked = await readSetupCookie();

  if (!unlocked) {
    return (
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Setup wizard
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter the operator-set <code>SETUP_PASSWORD</code> to unlock the ops console.
          </p>
        </header>
        <SetupUnlockForm />
      </section>
    );
  }

  const [status, instanceAccess, sdeState] = await Promise.all([
    loadStatus(),
    loadInstanceAccess(),
    loadSdeState(),
  ]);
  const knownTaskNames = onDemandJobModules()
    .map((m) => m.name)
    .sort();

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Setup wizard
          </h1>
          <p className="text-sm text-muted-foreground">
            On-demand triggers for migrations, static-data ingest, and named jobs.
          </p>
        </div>
        <form
          action={async () => {
            'use server';
            await setupLogoutAction();
          }}
        >
          <Button type="submit" variant="ghost" size="sm">
            Lock
          </Button>
        </form>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <RunMigrationsCard />
        <RunSdeRefreshCard />
        <RunSdeIngestCard />
        <RunCsvIngestCard />
      </div>

      <SdeStatePanel state={sdeState} />

      <InstanceAccessPanel config={instanceAccess} />

      <CronOnDemand taskNames={knownTaskNames} />

      <StatusPanel status={status} />
    </>
  );
}

function CronOnDemand({ taskNames }: { taskNames: string[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold tracking-tight">
        Run a registered job
      </h2>
      <p className="text-sm text-muted-foreground">
        Enqueues one of the registered graphile-worker tasks with an empty payload.
        Cron-driven jobs will resume their normal cadence after the on-demand run.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {taskNames.map((name) => (
          <RunCronCard key={name} taskName={name} />
        ))}
      </div>
    </section>
  );
}

function StatusPanel({ status }: { status: StatusSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Status</h2>
      <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <div className="font-medium text-foreground">Latest migration</div>
          <div>{status.latestMigration ?? '—'}</div>
        </div>
        <div>
          <div className="font-medium text-foreground">Map events (1h)</div>
          <div>{status.recentEventCount}</div>
        </div>
        <div>
          <div className="font-medium text-foreground">Job rows shown</div>
          <div>{status.recentRuns.length}</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Ended</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {status.recentRuns.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                  No job runs recorded yet.
                </td>
              </tr>
            ) : (
              status.recentRuns.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{r.name}</td>
                  <td className="px-3 py-2 text-xs">{r.startedAt.toISOString()}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.endedAt ? r.endedAt.toISOString() : 'in-flight'}
                  </td>
                  <td className="px-3 py-2 text-xs">{statusLabel(r.success, r.endedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function iso(at: Date | null): string {
  return at ? at.toISOString() : '—';
}

function buildLabel(build: number | null, releaseDate: string | null): string {
  if (build === null) return '—';
  return releaseDate ? `${build} (${releaseDate})` : String(build);
}

/** `retained_orphans` is jsonb, so it arrives untyped; narrow before reading. */
function orphanSummary(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const parts = Object.entries(value as Record<string, unknown>).flatMap(([table, v]) => {
    const retained = (v as { retained?: unknown } | null)?.retained;
    return typeof retained === 'number' && retained > 0 ? [`${table} (${retained})`] : [];
  });
  return parts.length > 0 ? parts.join(', ') : null;
}

function codeSummary(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map(String).join(', ');
}

function SdeField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium text-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function SdeStatePanel({ state }: { state: ApSdeState | null }) {
  if (!state) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Static data (SDE)</h2>
        <p className="text-sm text-muted-foreground">
          No state recorded yet. Run an SDE ingest or the refresh job to populate it.
        </p>
      </section>
    );
  }

  const orphans = orphanSummary(state.retainedOrphans);
  const codes = codeSummary(state.uncatalogedWormholeCodes);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Static data (SDE)</h2>
      <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
        <SdeField
          label="Current build"
          value={buildLabel(state.currentBuild, state.currentReleaseDate)}
        />
        <SdeField
          label="Latest seen"
          value={buildLabel(state.latestBuild, state.latestReleaseDate)}
        />
        <SdeField label="Last checked" value={iso(state.checkedAt)} />
        <SdeField label="Last refreshed" value={iso(state.refreshedAt)} />
        <SdeField label="Behind since" value={iso(state.behindSince)} />
        <SdeField label="Consecutive failures" value={String(state.consecutiveFailures)} />
      </div>
      {state.failedAt && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <div className="font-medium text-foreground">
            Last failure {state.failedAt.toISOString()}
          </div>
          <div className="text-muted-foreground">
            {state.failureReason ?? 'No reason recorded.'}
          </div>
        </div>
      )}
      {orphans && (
        <div className="text-sm">
          <div className="font-medium text-foreground">Retained orphans</div>
          <div className="text-muted-foreground">{orphans}</div>
        </div>
      )}
      {codes && (
        <div className="text-sm">
          <div className="font-medium text-foreground">Uncataloged wormhole codes</div>
          <div className="text-muted-foreground">{codes}</div>
        </div>
      )}
    </section>
  );
}

function statusLabel(success: boolean | null, endedAt: Date | null): string {
  if (endedAt === null) return 'running';
  if (success === true) return 'ok';
  if (success === false) return 'fail';
  return 'unknown';
}
