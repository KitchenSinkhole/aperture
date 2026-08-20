import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apSdeState } from '@/db/schema';
import { fetchLatestSdeManifest, recordSdeFailure, SDE_BUILD, SDE_RELEASE_DATE } from '@/lib/sde/ingest';
import { SDE_QUEUE } from '../queues';
import { runSdeIngestChild } from '../sdeIngestChild';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * Daily cron: checks CCP's `latest.jsonl` manifest against `ap_sde_state`,
 * and when a newer build has been published, ingests it through the Stage 2
 * child-process wrapper (same isolation as the on-demand `sde-ingest` task).
 * A failed gate (`SdeFormatError`/`SdeGateError` inside the child) never
 * reaches this handler as a partial write — `runIngest` writes nothing until
 * every gate passes — so a failure here always means the database is
 * unchanged and still serving the prior build.
 *
 * `12:15` UTC: shortly after the ~11:29 UTC window CCP publishes builds in,
 * outside the `CCP_SSO_DOWNTIME` back-off.
 */

const NAME = 'sde-refresh';

/** Row-existence fallback for a deployment upgrading in place without a prior `ap_sde_state` write. */
async function ensureStateRow(): Promise<{ currentBuild: number }> {
  const [row] = await db.select({ currentBuild: apSdeState.currentBuild }).from(apSdeState).where(eq(apSdeState.id, 1));
  if (row?.currentBuild != null) return { currentBuild: row.currentBuild };
  await db
    .insert(apSdeState)
    .values({ id: 1, currentBuild: SDE_BUILD, currentReleaseDate: SDE_RELEASE_DATE })
    .onConflictDoNothing();
  return { currentBuild: SDE_BUILD };
}

interface RefreshResult {
  latestBuild: number;
  currentBuild: number;
  refreshed: boolean;
  counts?: Record<string, number>;
}

async function refresh(): Promise<RefreshResult> {
  const { currentBuild } = await ensureStateRow();

  let manifest: { build: number; releaseDate: string };
  try {
    manifest = await fetchLatestSdeManifest();
  } catch (err) {
    // A check that never reached its comparison is a failure worth naming in
    // `/setup`; `checked_at` stops advancing, which is what the banner reads.
    await recordSdeFailure(err instanceof Error ? err.message : String(err));
    throw err;
  }

  const behind = manifest.build > currentBuild;
  await db
    .update(apSdeState)
    .set({
      latestBuild: manifest.build,
      latestReleaseDate: manifest.releaseDate,
      checkedAt: new Date(),
      // `coalesce` holds the timestamp of the check that first saw the gap
      // across every later check, so the grace window measures the age of the
      // gap rather than the age of the most recent check.
      behindSince: behind ? sql`coalesce(${apSdeState.behindSince}, now())` : null,
      // A converged check is the only thing that retires a failure on a healthy
      // deployment: the steady state ingests nothing, so `recordSdeIngestSuccess`
      // never runs and a transient blip would otherwise stand in `/setup` forever
      // and accumulate into a counter that is no longer consecutive. While
      // behind, the ingest that follows owns the outcome, so leave it alone.
      ...(behind ? {} : { failedAt: null, failureReason: null, consecutiveFailures: 0 }),
    })
    .where(eq(apSdeState.id, 1));

  if (!behind) {
    return { latestBuild: manifest.build, currentBuild, refreshed: false };
  }

  try {
    const result = await runSdeIngestChild({ build: manifest.build, releaseDate: manifest.releaseDate });
    return { latestBuild: manifest.build, currentBuild, refreshed: true, counts: result.counts };
  } catch (err) {
    await recordSdeFailure(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export const sdeRefresh: JobModule = {
  name: NAME,
  cron: '15 12 * * *',
  queue: SDE_QUEUE,
  // A build CCP published is still there tomorrow, so the daily tick is the
  // retry. Grinding a failing ~100MB ingest for hours holds the shared SDE
  // queue against `sde-ingest` and `csv-ingest` for no gain.
  maxAttempts: 2,
  run: withInstrumentation(NAME, refresh),
};
