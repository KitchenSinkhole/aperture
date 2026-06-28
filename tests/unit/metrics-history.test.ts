// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deriveSeries } from '@/lib/metrics/history';
import type { ApMetricSnapshot } from '@/types';

const BASE = new Date('2026-06-28T00:00:00.000Z');

/** A snapshot row with everything zeroed except the given overrides. */
function row(capturedAt: Date, overrides: Partial<ApMetricSnapshot> = {}): ApMetricSnapshot {
  return {
    id: 0,
    capturedAt,
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

function plusMinutes(n: number): Date {
  return new Date(BASE.getTime() + n * 60_000);
}

describe('deriveSeries', () => {
  it('returns no points for fewer than two rows', () => {
    expect(deriveSeries([])).toEqual([]);
    expect(deriveSeries([row(BASE)])).toEqual([]);
    expect(deriveSeries([row(BASE), row(plusMinutes(1))]).length).toBe(1);
  });

  it('derives rates, failure %, and averages from inter-row deltas', () => {
    const rows = [
      row(BASE, {
        esiRequestsTotal: 100,
        esiRequestsFailed: 10,
        esiDurationSumMs: 5000,
        esiDurationCount: 50,
        routePlanDurationSumMs: 200,
        routePlanDurationCount: 10,
      }),
      row(plusMinutes(1), {
        esiRequestsTotal: 220, // +120 over 1 min
        esiRequestsFailed: 40, // +30 → 25% of 120
        esiDurationSumMs: 11000, // +6000 over +50 obs → 120ms avg
        esiDurationCount: 100,
        routePlanDurationSumMs: 400, // +200 over +5 obs → 40ms avg
        routePlanDurationCount: 15,
        trackedCharacters: 12,
        processRssBytes: 2 * 1024 * 1024,
        processHeapUsedBytes: 1024 * 1024,
      }),
    ];

    const [p] = deriveSeries(rows);
    expect(p!.t).toBe(plusMinutes(1).getTime());
    expect(p!.esiRequestRate).toBe(120);
    expect(p!.esiFailurePct).toBe(25);
    expect(p!.esiAvgLatencyMs).toBe(120);
    expect(p!.routeAvgLatencyMs).toBe(40);
    expect(p!.trackedCharacters).toBe(12);
    expect(p!.processRssMb).toBe(2);
    expect(p!.processHeapUsedMb).toBe(1);
  });

  it('returns null for zero-denominator intervals (no requests / no observations)', () => {
    const rows = [
      row(BASE, { esiRequestsTotal: 50, esiDurationCount: 5, routePlanDurationCount: 2 }),
      row(plusMinutes(1), { esiRequestsTotal: 50, esiDurationCount: 5, routePlanDurationCount: 2 }),
    ];
    const [p] = deriveSeries(rows);
    expect(p!.esiRequestRate).toBe(0); // a defined 0/min, not null
    expect(p!.esiFailurePct).toBeNull();
    expect(p!.esiAvgLatencyMs).toBeNull();
    expect(p!.routeAvgLatencyMs).toBeNull();
  });

  it('treats a counter drop as a process restart (reset guard)', () => {
    const rows = [
      row(BASE, {
        esiRequestsTotal: 1000,
        esiRequestsFailed: 100,
        esiDurationSumMs: 50_000,
        esiDurationCount: 500,
      }),
      row(plusMinutes(1), {
        esiRequestsTotal: 30, // dropped → registry reset; +30 is the post-reset increment
        esiRequestsFailed: 5,
        esiDurationSumMs: 800,
        esiDurationCount: 10,
      }),
    ];
    const [p] = deriveSeries(rows);
    expect(p!.esiRequestRate).toBe(30);
    expect(p!.esiFailurePct).toBeCloseTo((5 / 30) * 100, 6);
    expect(p!.esiAvgLatencyMs).toBe(80); // 800 / 10
  });
});
