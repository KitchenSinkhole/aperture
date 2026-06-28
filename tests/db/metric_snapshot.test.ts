// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { inArray, sql } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { apMetricSnapshot } from '@/db/schema';
import { loadMetricHistory } from '@/lib/metrics/history';

/**
 * `ap_metric_snapshot` round-trips, the read path runs against real Postgres
 * (date_bin / DISTINCT ON), and the 30-day pg_partman retention is configured.
 *
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * Only rows this test inserts are touched (deleted by id in afterAll), so it is
 * safe against the ambient snapshots a running worker may be writing.
 */
const run = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!run)('ap_metric_snapshot (real Postgres)', () => {
  const ids: number[] = [];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    // Three rows spaced >5 min apart so the 24h (5-min) bucketing keeps them
    // distinct → at least two derived points from our own data.
    const inserted = await db
      .insert(apMetricSnapshot)
      .values([
        snapshotValues(12, { esiRequestsTotal: 100, esiRequestsFailed: 10, trackedCharacters: 5 }),
        snapshotValues(6, { esiRequestsTotal: 220, esiRequestsFailed: 40, trackedCharacters: 7 }),
        snapshotValues(1, { esiRequestsTotal: 300, esiRequestsFailed: 55, trackedCharacters: 9 }),
      ])
      .returning({ id: apMetricSnapshot.id });
    ids.push(...inserted.map((r) => r.id));
  });

  afterAll(async () => {
    if (ids.length) await db.delete(apMetricSnapshot).where(inArray(apMetricSnapshot.id, ids));
    await pool.end();
  });

  it('round-trips numeric columns (bigint mode: number)', async () => {
    const rows = await db
      .select()
      .from(apMetricSnapshot)
      .where(inArray(apMetricSnapshot.id, ids));
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(typeof r.esiRequestsTotal).toBe('number');
      expect(typeof r.processRssBytes).toBe('number');
    }
  });

  it('loads a well-formed, derived history over a real window', async () => {
    const history = await loadMetricHistory('24h');
    expect(history.range).toBe('24h');
    expect(Array.isArray(history.points)).toBe(true);
    expect(Array.isArray(history.jobRuns)).toBe(true);
    // Our three spaced rows yield at least two derived points (ambient rows only add more).
    expect(history.points.length).toBeGreaterThanOrEqual(2);
    for (const p of history.points) {
      expect(Number.isFinite(p.t)).toBe(true);
    }
  });

  it('configures 30-day pg_partman retention', async () => {
    const res = await db.execute<{ retention: string | null }>(sql`
      SELECT retention FROM partman.part_config
      WHERE parent_table = 'public.ap_metric_snapshot'
    `);
    expect(res.rows[0]?.retention).toBe('30 days');
  });
});

function snapshotValues(minutesAgo: number, overrides: Record<string, number>) {
  return {
    capturedAt: sql`now() - interval '${sql.raw(String(minutesAgo))} minutes'`,
    esiRequestsTotal: 0,
    esiRequestsFailed: 0,
    esiDurationSumMs: 0,
    esiDurationCount: 0,
    routePlanDurationSumMs: 0,
    routePlanDurationCount: 0,
    trackedCharacters: 0,
    visibleSystems: 0,
    wsConnections: 0,
    esiBreakersOpen: 0,
    jobBacklog: 0,
    jobsAbandoned: 0,
    processRssBytes: 0,
    processHeapUsedBytes: 0,
    eventLoopLagMs: 0,
    ...overrides,
  };
}
