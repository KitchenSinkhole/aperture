import { sql } from 'drizzle-orm';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import { apMetricSnapshot } from '@/db/schema';
import { sampleGauges } from '@/lib/metrics/gauges';
import {
  ESI_REQUESTS_TOTAL,
  ESI_REQUEST_DURATION_MS,
  ROUTE_PLAN_DURATION_MS,
  metrics,
} from '@/lib/metrics/registry';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';
import type { MetricsSnapshot } from '@/types';

/**
 * `metrics-snapshot` cron: sample the in-process metric registry +
 * instantaneous gauges into one `ap_metric_snapshot` row. `/metrics` (Phase 3)
 * is point-in-time; this is the history the admin metrics page graphs.
 *
 * The worker shares the web server's process (`server.ts` boots graphile-worker
 * after `server.listen`), so the registry sampled here is the same singleton the
 * web request handlers (route planning) and the location-poll worker write to.
 *
 * Counter/histogram rollups are stored cumulatively (raw registry values);
 * rates/averages are derived from inter-row deltas on read (`deriveSeries`).
 *
 * Must NOT import `server-only` — runs in the bare-`tsx` worker.
 */

const NAME = 'metrics-snapshot';

/** Sum a counter's series values; `predicate` narrows to a subset of label-sets. */
function sumCounter(
  snap: MetricsSnapshot,
  name: string,
  predicate: (labels: Record<string, string>) => boolean = () => true,
): number {
  const counter = snap.counters.find((c) => c.name === name);
  if (!counter) return 0;
  return counter.series.reduce((acc, s) => (predicate(s.labels) ? acc + s.value : acc), 0);
}

/** Aggregate a histogram's `sum` and `count` across every label-set. */
function aggregateHistogram(snap: MetricsSnapshot, name: string): { sum: number; count: number } {
  const histogram = snap.histograms.find((h) => h.name === name);
  if (!histogram) return { sum: 0, count: 0 };
  return histogram.series.reduce(
    (acc, s) => ({ sum: acc.sum + s.sum, count: acc.count + s.count }),
    { sum: 0, count: 0 },
  );
}

async function snapshotMetrics(): Promise<{ capturedAt: string }> {
  const snap = metrics.snapshot();
  const gauges = await sampleGauges();

  const esiDuration = aggregateHistogram(snap, ESI_REQUEST_DURATION_MS);
  const routeDuration = aggregateHistogram(snap, ROUTE_PLAN_DURATION_MS);

  const [row] = await db
    .insert(apMetricSnapshot)
    .values({
      capturedAt: sql`now()`,
      esiRequestsTotal: sumCounter(snap, ESI_REQUESTS_TOTAL),
      esiRequestsFailed: sumCounter(snap, ESI_REQUESTS_TOTAL, (l) => l.outcome !== 'success'),
      esiDurationSumMs: esiDuration.sum,
      esiDurationCount: esiDuration.count,
      routePlanDurationSumMs: routeDuration.sum,
      routePlanDurationCount: routeDuration.count,
      trackedCharacters: gauges.trackedCharacters,
      visibleSystems: gauges.visibleSystems,
      wsConnections: gauges.wsConnections,
      esiBreakersOpen: gauges.openEsiBreakers,
      jobBacklog: gauges.jobBacklog,
      jobsAbandoned: gauges.jobsAbandoned,
      processRssBytes: gauges.processRssBytes,
      processHeapUsedBytes: gauges.processHeapUsedBytes,
      eventLoopLagMs: gauges.eventLoopLagMs,
    })
    .returning({ capturedAt: apMetricSnapshot.capturedAt });

  return { capturedAt: row!.capturedAt.toISOString() };
}

export const metricsSnapshot: JobModule = {
  name: NAME,
  cron: apertureConfig.METRICS_SNAPSHOT_CRON,
  run: withInstrumentation(NAME, snapshotMetrics),
};
