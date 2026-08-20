import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apSdeState } from '@/db/schema';
import { recordSdeFailure, SDE_BUILD, SDE_RELEASE_DATE } from '@/lib/sde/ingest';
import { SDE_QUEUE } from '../queues';
import { runSdeIngestChild, type SdeIngestOverride } from '../sdeIngestChild';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * graphile-worker wrapper around an on-demand re-ingest of the build the
 * database already holds, so the setup wizard can re-run the pipeline without
 * shelling into the container. Runs via `runSdeIngestChild`
 * (`../sdeIngestChild.ts`), which isolates the ~100MB JSONL parse and bulk
 * upserts in a child process so they don't starve WS heartbeats or contend
 * with the app's `pg.Pool`.
 */

const NAME = 'sde-ingest';

/**
 * Which build to re-run is console policy, not an ingest-engine default, so it
 * is resolved here and passed explicitly — `runIngest()` with no override
 * keeps meaning "the pin", which is what `pnpm sde:bootstrap` wants. Ingesting
 * the pin on a deployment that has self-refreshed past it would walk the
 * database backwards through deletion sync.
 */
async function resolveBuild(): Promise<SdeIngestOverride> {
  const [row] = await db
    .select({ build: apSdeState.currentBuild, releaseDate: apSdeState.currentReleaseDate })
    .from(apSdeState)
    .where(eq(apSdeState.id, 1));
  if (row?.build == null) return { build: SDE_BUILD, releaseDate: SDE_RELEASE_DATE };
  return { build: row.build, releaseDate: row.releaseDate ?? SDE_RELEASE_DATE };
}

async function ingest() {
  const override = await resolveBuild();
  try {
    return await runSdeIngestChild(override);
  } catch (err) {
    await recordSdeFailure(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export const sdeIngest: JobModule = {
  name: NAME,
  queue: SDE_QUEUE,
  // An operator-triggered run that fails is a run the operator is watching:
  // one retry covers a flaky download, and anything past that should surface
  // in `/setup` as a failure to act on rather than grind for hours.
  maxAttempts: 2,
  run: withInstrumentation(NAME, ingest),
};
