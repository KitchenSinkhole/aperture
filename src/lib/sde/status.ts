import { eq } from 'drizzle-orm';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import { apSdeState } from '@/db/schema';

/**
 * Derives the user-facing static-data health from the `ap_sde_state` singleton.
 * Backs both the `(app)` layout banner (server-rendered) and
 * `GET /api/sde-status` (the client's refetch), so the two can never disagree.
 */

export type SdeStatusState = 'ok' | 'stale' | 'failing';

export interface SdeStatus {
  state: SdeStatusState;
  currentBuild: number | null;
  latestBuild: number | null;
  /** ISO-8601, or `null` when no check has ever landed. */
  checkedAt: string | null;
}

const HOUR_MS = 3_600_000;

function olderThan(at: Date | null, hours: number, now: number): boolean {
  if (at === null) return true;
  return now - at.getTime() > hours * HOUR_MS;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export async function getSdeStatus(): Promise<SdeStatus> {
  const [row] = await db.select().from(apSdeState).where(eq(apSdeState.id, 1));

  // No row means no ingest and no check has ever run through this codebase.
  // The `universe_*` tables may still be fine (bootstrapped before the state
  // row existed), so this is stale, not failing.
  if (!row) {
    return { state: 'stale', currentBuild: null, latestBuild: null, checkedAt: null };
  }

  const now = Date.now();
  const base = {
    currentBuild: row.currentBuild,
    latestBuild: row.latestBuild,
    checkedAt: row.checkedAt?.toISOString() ?? null,
  };

  const behind =
    row.latestBuild !== null && row.currentBuild !== null && row.latestBuild > row.currentBuild;

  // A failed attempt only matters to a viewer while it is still keeping them
  // off the current build; a failure the next run recovered from is history.
  if (row.failedAt !== null && behind) return { state: 'failing', ...base };

  // Two independent staleness clocks. The gap clock catches a refresh that ran
  // and did not close the gap; the check clock catches a refresh that never
  // reached its comparison at all, where `latest_build` never advances and the
  // gap clock therefore sees nothing wrong.
  //
  // The check clock runs from the later of `checked_at` and `refreshed_at`: a
  // deployment freshly bootstrapped from the pinned build has never checked,
  // and must not be called stale before the first daily cron gets its chance.
  const lastSignal = latest(row.checkedAt, row.refreshedAt);
  const gapStale = behind && olderThan(row.behindSince, apertureConfig.SDE_STALE_GRACE_HOURS, now);
  const checkStale = olderThan(lastSignal, apertureConfig.SDE_CHECK_STALE_HOURS, now);
  if (gapStale || checkStale) return { state: 'stale', ...base };

  return { state: 'ok', ...base };
}
