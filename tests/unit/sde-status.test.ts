// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ApSdeState } from '@/types';

// getSdeStatus is pure logic over a single row, so a controllable mock row
// keeps this DB-free — the same builder pattern as tests/unit/integration-token.test.ts.
const mockRow: { value: ApSdeState | null } = { value: null };

vi.mock('@/db/client', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.where = () => builder;
  builder.then = (resolve: (rows: unknown[]) => unknown) =>
    resolve(mockRow.value ? [mockRow.value] : []);
  return { db: { select: () => builder } };
});

import { getSdeStatus } from '@/lib/sde/status';

const HOUR_MS = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS);

function state(overrides: Partial<ApSdeState> = {}): ApSdeState {
  return {
    id: 1,
    currentBuild: 100,
    currentReleaseDate: '2026-01-01',
    latestBuild: 100,
    latestReleaseDate: '2026-01-01',
    checkedAt: hoursAgo(1),
    behindSince: null,
    refreshedAt: hoursAgo(1),
    failedAt: null,
    failureReason: null,
    consecutiveFailures: 0,
    retainedOrphans: null,
    uncatalogedWormholeCodes: null,
    ...overrides,
  };
}

const behind = { latestBuild: 200, latestReleaseDate: '2026-02-01' } satisfies Partial<ApSdeState>;

describe('getSdeStatus', () => {
  const cases: Array<[string, ApSdeState | null, 'ok' | 'stale' | 'failing']> = [
    // No row at all: universe_* may well be fine, so this is stale, never failing.
    ['no state row', null, 'stale'],

    ['builds converged and checked recently', state(), 'ok'],

    // Gap clock: the grace window runs from behind_since, not from checked_at.
    ['behind inside the grace window', state({ ...behind, behindSince: hoursAgo(1) }), 'ok'],
    ['behind past the grace window', state({ ...behind, behindSince: hoursAgo(3) }), 'stale'],

    // Check clock: catches the runner-stopped case, which the gap alone cannot see
    // because latest_build only advances when a check succeeds.
    ['no check or ingest inside the window', state({ checkedAt: hoursAgo(40), refreshedAt: hoursAgo(40) }), 'stale'],
    ['a recent ingest with a long-stopped check', state({ checkedAt: hoursAgo(40), refreshedAt: hoursAgo(1) }), 'ok'],
    ['a recent check with an old ingest', state({ checkedAt: hoursAgo(1), refreshedAt: hoursAgo(400) }), 'ok'],
    // Freshly bootstrapped from the pin: never checked, and must not be called stale
    // before the first daily cron gets its chance.
    ['freshly bootstrapped, never checked', state({ checkedAt: null, latestBuild: null, latestReleaseDate: null }), 'ok'],
    ['never checked and never ingested', state({ checkedAt: null, refreshedAt: null, latestBuild: null, latestReleaseDate: null }), 'stale'],

    // failing needs both a failure and a gap it is still keeping the viewer off.
    ['failed while behind, inside the grace window', state({ ...behind, behindSince: hoursAgo(1), failedAt: hoursAgo(1), failureReason: 'gate', consecutiveFailures: 1 }), 'failing'],
    ['failed while behind, past the grace window', state({ ...behind, behindSince: hoursAgo(3), failedAt: hoursAgo(1), failureReason: 'gate', consecutiveFailures: 1 }), 'failing'],
    ['failed but no longer behind', state({ failedAt: hoursAgo(1), failureReason: 'gate', consecutiveFailures: 1 }), 'ok'],
    ['failed, not behind, and the check clock expired', state({ checkedAt: hoursAgo(40), refreshedAt: hoursAgo(40), failedAt: hoursAgo(40), failureReason: 'gate' }), 'stale'],

    // A null current_build cannot be behind anything, so it falls through to the check clock.
    ['null current_build with a known latest', state({ ...behind, currentBuild: null, currentReleaseDate: null }), 'ok'],
    ['null current_build and an expired check clock', state({ ...behind, currentBuild: null, currentReleaseDate: null, checkedAt: hoursAgo(40), refreshedAt: hoursAgo(40) }), 'stale'],
  ];

  it.each(cases)('reports %s as %s', async (_label, row, expected) => {
    mockRow.value = row;
    const status = await getSdeStatus();
    expect(status.state).toBe(expected);
  });

  it('reports the builds and check timestamp from the row', async () => {
    const checkedAt = hoursAgo(2);
    mockRow.value = state({ ...behind, behindSince: hoursAgo(1), checkedAt });

    expect(await getSdeStatus()).toMatchObject({
      currentBuild: 100,
      latestBuild: 200,
      checkedAt: checkedAt.toISOString(),
    });
  });

  it('reports null builds when there is no state row', async () => {
    mockRow.value = null;

    expect(await getSdeStatus()).toEqual({
      state: 'stale',
      currentBuild: null,
      latestBuild: null,
      checkedAt: null,
    });
  });
});
