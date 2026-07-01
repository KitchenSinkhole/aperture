// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Both instrumented modules touch the DB (routePlanner reads the graph;
// client.ts resolves character tokens). A single chainable, thenable builder
// resolves every query to `[]`, keeping these tests DB-free — the point is the
// metrics side effect, not the data.
vi.mock('@/db/client', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.innerJoin = () => builder;
  builder.where = () => builder;
  builder.orderBy = () => builder;
  builder.limit = () => builder;
  builder.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return {
    db: { select: () => builder, execute: async () => ({ rows: [] }) },
    pool: { query: vi.fn(async () => ({ rows: [] })), end: vi.fn() },
  };
});

import type { NextRequest } from 'next/server';
import { esiCall, EsiBreakerOpenError, EsiHttpError } from '@/lib/esi/client';
import { statusSchema } from '@/lib/esi/decoders';
import { __resetBreakersForTest } from '@/lib/esi/breaker';
import { planRoutes } from '@/lib/map/routePlanner';
import {
  metrics,
  recordMapEvent,
  recordJobRun,
  recordRealtimeBroadcast,
  ESI_REQUESTS_TOTAL,
  ESI_REQUEST_DURATION_MS,
  ROUTE_PLAN_DURATION_MS,
  MAP_EVENTS_TOTAL,
  JOB_RUNS_TOTAL,
  JOB_DURATION_MS,
  REALTIME_BROADCASTS_TOTAL,
  HTTP_REQUESTS_TOTAL,
  HTTP_REQUEST_DURATION_MS,
} from '@/lib/metrics/registry';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';
import type { MetricLabels, MetricsSnapshot } from '@/types';

const NON_DOWNTIME = new Date('2026-01-01T00:00:00Z');

function statusResponse() {
  return new Response(JSON.stringify({ players: 30000, server_version: '1', start_time: NON_DOWNTIME.toISOString() }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function labelsMatch(actual: MetricLabels, expected: MetricLabels): boolean {
  return Object.entries(expected).every(([k, v]) => actual[k] === v);
}

function counterValue(snap: MetricsSnapshot, name: string, labels: MetricLabels): number {
  const counter = snap.counters.find((c) => c.name === name);
  const series = counter?.series.find((s) => labelsMatch(s.labels, labels));
  return series?.value ?? 0;
}

function histogram(snap: MetricsSnapshot, name: string, labels: MetricLabels = {}) {
  const h = snap.histograms.find((m) => m.name === name);
  return h?.series.find((s) => labelsMatch(s.labels, labels));
}

beforeEach(() => {
  metrics.reset();
  __resetBreakersForTest();
  vi.useFakeTimers();
  vi.setSystemTime(NON_DOWNTIME); // keep `inDowntimeWindow()` false
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('metrics registry', () => {
  it('pre-registers the core metrics with empty series', () => {
    const snap = metrics.snapshot();
    expect(snap.counters.map((c) => c.name)).toContain(ESI_REQUESTS_TOTAL);
    expect(snap.histograms.map((h) => h.name)).toEqual(
      expect.arrayContaining([ESI_REQUEST_DURATION_MS, ROUTE_PLAN_DURATION_MS]),
    );
    expect(counterValue(snap, ESI_REQUESTS_TOTAL, { outcome: 'success' })).toBe(0);
  });

  it('accumulates counters by label-set independent of key order', () => {
    metrics.incrementCounter(ESI_REQUESTS_TOTAL, { operationId: 'GetStatus', outcome: 'success' });
    metrics.incrementCounter(ESI_REQUESTS_TOTAL, { outcome: 'success', operationId: 'GetStatus' }, 2);
    const snap = metrics.snapshot();
    expect(counterValue(snap, ESI_REQUESTS_TOTAL, { operationId: 'GetStatus', outcome: 'success' })).toBe(3);
  });

  it('records cumulative `le` buckets, sum and count', () => {
    metrics.observeHistogram(ROUTE_PLAN_DURATION_MS, {}, 3);
    metrics.observeHistogram(ROUTE_PLAN_DURATION_MS, {}, 40);
    const series = histogram(metrics.snapshot(), ROUTE_PLAN_DURATION_MS)!;
    expect(series.count).toBe(2);
    expect(series.sum).toBe(43);
    // Buckets [1,2,5,10,25,50,...]: 3 falls into >=5; 40 into >=50.
    expect(series.counts[0]).toBe(0); // le 1
    expect(series.counts[2]).toBe(1); // le 5 — just the 3
    expect(series.counts[5]).toBe(2); // le 50 — both
  });
});

describe('esiCall instrumentation', () => {
  it('tallies a success and observes its latency', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse()));
    const status = await esiCall('getStatus', { schema: statusSchema });
    expect(status.players).toBe(30000);

    const snap = metrics.snapshot();
    expect(counterValue(snap, ESI_REQUESTS_TOTAL, { operationId: 'GetStatus', outcome: 'success' })).toBe(1);
    expect(histogram(snap, ESI_REQUEST_DURATION_MS, { operationId: 'GetStatus' })!.count).toBe(1);
  });

  it('tallies an http_error outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiHttpError);
    expect(counterValue(metrics.snapshot(), ESI_REQUESTS_TOTAL, { outcome: 'http_error' })).toBe(1);
  });

  it('tallies breaker_open without observing latency', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    // Trip the breaker (threshold 5), then the 6th call short-circuits open.
    for (let i = 0; i < 5; i++) {
      await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiHttpError);
    }
    await expect(esiCall('getStatus', { schema: statusSchema })).rejects.toBeInstanceOf(EsiBreakerOpenError);

    const snap = metrics.snapshot();
    expect(counterValue(snap, ESI_REQUESTS_TOTAL, { outcome: 'breaker_open' })).toBe(1);
    // The 5 real requests are timed; the short-circuited one is not.
    expect(histogram(snap, ESI_REQUEST_DURATION_MS, { operationId: 'GetStatus' })!.count).toBe(5);
  });
});

describe('planRoutes instrumentation', () => {
  it('observes a route_plan_duration_ms sample', async () => {
    await planRoutes({ mapId: 1n, sourceSystemId: 30000142, destinationSystemIds: [30002187], prefs: {
      safety: 'shortest',
      minShipClass: null,
      avoidReduced: false,
      avoidCritical: false,
      avoidEol: false,
      includeEveScout: false,
    } });
    expect(histogram(metrics.snapshot(), ROUTE_PLAN_DURATION_MS)!.count).toBe(1);
  });
});

describe('Phase 8 — Tier 1 realtime/mutation pipeline', () => {
  it('tallies map_events_total by event kind', () => {
    recordMapEvent('system.added');
    recordMapEvent('system.added');
    recordMapEvent('connection.create');
    const snap = metrics.snapshot();
    expect(counterValue(snap, MAP_EVENTS_TOTAL, { task: 'system.added' })).toBe(2);
    expect(counterValue(snap, MAP_EVENTS_TOTAL, { task: 'connection.create' })).toBe(1);
  });

  it('tallies realtime_broadcasts_total and observes fanout duration', () => {
    recordRealtimeBroadcast('mapUpdate', 3);
    const snap = metrics.snapshot();
    expect(counterValue(snap, REALTIME_BROADCASTS_TOTAL, { task: 'mapUpdate' })).toBe(1);
    // realtime_fanout_duration_ms is label-free.
    expect(histogram(snap, 'realtime_fanout_duration_ms')!.count).toBe(1);
  });
});

describe('Phase 8 — Tier 2 withApiMetrics', () => {
  function fakeRequest(method: string): NextRequest {
    return { method } as unknown as NextRequest;
  }

  it('records http_requests_total and http_request_duration_ms for a handled response', async () => {
    const handler = withApiMetrics('/api/test/:id', async () => new Response(null, { status: 204 }));
    const res = await handler(fakeRequest('POST'), {} as never);
    expect(res.status).toBe(204);

    const snap = metrics.snapshot();
    expect(
      counterValue(snap, HTTP_REQUESTS_TOTAL, { route: '/api/test/:id', method: 'POST', status: '204' }),
    ).toBe(1);
    expect(histogram(snap, HTTP_REQUEST_DURATION_MS, { route: '/api/test/:id' })!.count).toBe(1);
  });

  it('records status 500 and re-throws when the handler throws', async () => {
    const handler = withApiMetrics('/api/test/:id', async () => {
      throw new Error('boom');
    });
    await expect(handler(fakeRequest('GET'), {} as never)).rejects.toThrow('boom');
    expect(
      counterValue(metrics.snapshot(), HTTP_REQUESTS_TOTAL, {
        route: '/api/test/:id',
        method: 'GET',
        status: '500',
      }),
    ).toBe(1);
  });
});

describe('Phase 8 — Tier 3 job-run helper', () => {
  it('tallies job_runs_total by outcome and observes job_duration_ms', () => {
    recordJobRun('location-poll', 'success', 12);
    recordJobRun('location-poll', 'failure', 30);
    const snap = metrics.snapshot();
    expect(counterValue(snap, JOB_RUNS_TOTAL, { task: 'location-poll', outcome: 'success' })).toBe(1);
    expect(counterValue(snap, JOB_RUNS_TOTAL, { task: 'location-poll', outcome: 'failure' })).toBe(1);
    expect(histogram(snap, JOB_DURATION_MS, { task: 'location-poll' })!.count).toBe(2);
  });
});
