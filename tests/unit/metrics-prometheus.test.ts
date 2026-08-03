// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import {
  metrics,
  ESI_REQUESTS_TOTAL,
  ESI_REQUEST_DURATION_MS,
  ROUTE_PLAN_DURATION_MS,
} from '@/lib/metrics/registry';
import { renderPrometheus } from '@/lib/metrics/prometheus';
import type { GaugeReadings } from '@/types';

const GAUGES: GaugeReadings = {
  trackedCharacters: 12,
  visibleSystems: 47,
  wsConnections: 3,
  publicWsConnections: 8,
  openEsiBreakers: 0,
  jobBacklog: 1,
  jobsAbandoned: 0,
  dbPoolTotal: 5,
  dbPoolIdle: 4,
  dbPoolWaiting: 0,
  processRssBytes: 123_456_789,
  processHeapUsedBytes: 45_000_000,
  processHeapTotalBytes: 60_000_000,
  eventLoopLagMs: 0.5,
  tableRows: [
    { table: 'ap_job_run', rows: 14_532_586 },
    { table: 'universe_killmail', rows: 1234 },
  ],
};

function lines(body: string): string[] {
  return body.split('\n');
}

beforeEach(() => {
  metrics.reset();
});

describe('renderPrometheus', () => {
  it('emits HELP/TYPE headers and a trailing newline', () => {
    const body = renderPrometheus(metrics.snapshot(), GAUGES);
    expect(body.endsWith('\n')).toBe(true);
    expect(body).toContain(`# TYPE ${ESI_REQUESTS_TOTAL} counter`);
    expect(body).toContain(`# TYPE ${ESI_REQUEST_DURATION_MS} histogram`);
    expect(body).toContain('# TYPE tracked_characters gauge');
  });

  it('renders counter series with sorted, quoted labels', () => {
    metrics.incrementCounter(ESI_REQUESTS_TOTAL, { operationId: 'GetStatus', outcome: 'success' }, 4);
    const body = renderPrometheus(metrics.snapshot(), GAUGES);
    expect(lines(body)).toContain(`${ESI_REQUESTS_TOTAL}{operationId="GetStatus",outcome="success"} 4`);
  });

  it('renders cumulative buckets, a +Inf bucket, sum and count for a histogram', () => {
    metrics.observeHistogram(ROUTE_PLAN_DURATION_MS, {}, 3);
    metrics.observeHistogram(ROUTE_PLAN_DURATION_MS, {}, 40);
    const out = lines(renderPrometheus(metrics.snapshot(), GAUGES));
    // Buckets [1,2,5,10,25,50,...]: 3 → first hits at le=5, 40 → at le=50.
    expect(out).toContain(`${ROUTE_PLAN_DURATION_MS}_bucket{le="5"} 1`);
    expect(out).toContain(`${ROUTE_PLAN_DURATION_MS}_bucket{le="50"} 2`);
    expect(out).toContain(`${ROUTE_PLAN_DURATION_MS}_bucket{le="+Inf"} 2`);
    expect(out).toContain(`${ROUTE_PLAN_DURATION_MS}_sum 43`);
    expect(out).toContain(`${ROUTE_PLAN_DURATION_MS}_count 2`);
  });

  it('renders every gauge with its instantaneous value', () => {
    const out = lines(renderPrometheus(metrics.snapshot(), GAUGES));
    expect(out).toContain('tracked_characters 12');
    expect(out).toContain('visible_systems 47');
    expect(out).toContain('ws_connections 3');
    expect(out).toContain('public_ws_connections 8');
    expect(out).toContain('process_resident_memory_bytes 123456789');
    expect(out).toContain('event_loop_lag_ms 0.5');
  });

  it('renders per-table row estimates as a labelled db_table_rows gauge', () => {
    const out = lines(renderPrometheus(metrics.snapshot(), GAUGES));
    expect(out).toContain('# TYPE db_table_rows gauge');
    expect(out).toContain('db_table_rows{table="ap_job_run"} 14532586');
    expect(out).toContain('db_table_rows{table="universe_killmail"} 1234');
  });
});
