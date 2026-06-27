import { apertureConfig } from '../../../aperture.config';
import { env } from '@/lib/env';
import type {
  CounterSnapshot,
  EsiMetricOutcome,
  HistogramSnapshot,
  MetricLabels,
  MetricsSnapshot,
} from '@/types';

/**
 * In-process metric registry — the cumulative side of Aperture's metrics
 * (counters + histograms). It is the shared dependency for both the `/metrics`
 * Prometheus endpoint (Phase 3) and the snapshot job (Phase 5); each reads the
 * same `snapshot()`.
 *
 * Plain TS, no Prometheus client lib. Singleton across HMR via `globalThis`,
 * mirroring `bus.ts` — a per-process accumulator, never persisted. Must NOT
 * import `server-only`: it's reached from `esiCall` (client.ts), which runs in
 * the background worker.
 *
 * Gauges are deliberately absent here — they're instantaneous and sampled at
 * scrape time by `gauges.ts`, not accumulated.
 */

/** Counter: ESI requests tallied by `operationId` + `outcome`. */
export const ESI_REQUESTS_TOTAL = 'esi_requests_total';
/** Histogram: ESI request round-trip latency, by `operationId`. */
export const ESI_REQUEST_DURATION_MS = 'esi_request_duration_ms';
/** Histogram: route-plan computation time. */
export const ROUTE_PLAN_DURATION_MS = 'route_plan_duration_ms';

type CounterState = {
  help: string;
  series: Map<string, { labels: MetricLabels; value: number }>;
};

type HistogramState = {
  help: string;
  buckets: number[];
  series: Map<string, { labels: MetricLabels; counts: number[]; sum: number; count: number }>;
};

/** Stable key for a label-set: sorted so label order doesn't fork a series. */
function labelKey(labels: MetricLabels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

class MetricsRegistry {
  private readonly counters = new Map<string, CounterState>();
  private readonly histograms = new Map<string, HistogramState>();

  constructor() {
    this.registerCore();
  }

  /**
   * Pre-register every core metric so a snapshot taken before any observation
   * still carries the full metric set (with empty series) — the formatter and
   * snapshot job get a stable shape.
   */
  private registerCore(): void {
    this.defineCounter(ESI_REQUESTS_TOTAL, 'ESI requests by operation and outcome.');
    this.defineHistogram(
      ESI_REQUEST_DURATION_MS,
      'ESI request round-trip latency in milliseconds.',
      apertureConfig.METRICS_ESI_LATENCY_BUCKETS_MS,
    );
    this.defineHistogram(
      ROUTE_PLAN_DURATION_MS,
      'Route-plan computation time in milliseconds.',
      apertureConfig.METRICS_ROUTE_LATENCY_BUCKETS_MS,
    );
  }

  private defineCounter(name: string, help: string): void {
    if (!this.counters.has(name)) this.counters.set(name, { help, series: new Map() });
  }

  private defineHistogram(name: string, help: string, buckets: readonly number[]): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { help, buckets: [...buckets], series: new Map() });
    }
  }

  /** Add `by` (default 1) to the counter series for `labels`. No-op if unknown. */
  incrementCounter(name: string, labels: MetricLabels = {}, by = 1): void {
    const counter = this.counters.get(name);
    if (!counter) return;
    const key = labelKey(labels);
    const existing = counter.series.get(key);
    if (existing) existing.value += by;
    else counter.series.set(key, { labels: { ...labels }, value: by });
  }

  /** Record one observation into the histogram series for `labels`. No-op if unknown. */
  observeHistogram(name: string, labels: MetricLabels, value: number): void {
    const histogram = this.histograms.get(name);
    if (!histogram) return;
    const key = labelKey(labels);
    let series = histogram.series.get(key);
    if (!series) {
      series = {
        labels: { ...labels },
        counts: new Array(histogram.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      histogram.series.set(key, series);
    }
    series.sum += value;
    series.count += 1;
    // Cumulative `le` buckets: an observation falls into every bucket whose
    // upper bound it does not exceed.
    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]!) series.counts[i]! += 1;
    }
  }

  /** Immutable point-in-time copy of every counter and histogram. */
  snapshot(): MetricsSnapshot {
    const counters: CounterSnapshot[] = [];
    for (const [name, c] of this.counters) {
      counters.push({
        name,
        help: c.help,
        series: [...c.series.values()].map((s) => ({ labels: { ...s.labels }, value: s.value })),
      });
    }
    const histograms: HistogramSnapshot[] = [];
    for (const [name, h] of this.histograms) {
      histograms.push({
        name,
        help: h.help,
        buckets: [...h.buckets],
        series: [...h.series.values()].map((s) => ({
          labels: { ...s.labels },
          counts: [...s.counts],
          sum: s.sum,
          count: s.count,
        })),
      });
    }
    return { counters, histograms };
  }

  /** Test-only: drop all accumulated series and re-register the core metrics. */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.registerCore();
  }
}

declare global {
  var __apertureMetricsRegistry: MetricsRegistry | undefined;
}

export const metrics = globalThis.__apertureMetricsRegistry ?? new MetricsRegistry();

if (env.NODE_ENV !== 'production') {
  globalThis.__apertureMetricsRegistry = metrics;
}

/**
 * Tally one ESI request. `durationMs` is `null` for outcomes where no request
 * left the process (`breaker_open`, `token_error`) so the latency histogram
 * isn't skewed by zero-duration short-circuits.
 */
export function recordEsiRequest(
  operationId: string,
  outcome: EsiMetricOutcome,
  durationMs: number | null,
): void {
  metrics.incrementCounter(ESI_REQUESTS_TOTAL, { operationId, outcome });
  if (durationMs !== null) {
    metrics.observeHistogram(ESI_REQUEST_DURATION_MS, { operationId }, durationMs);
  }
}

/** Record one route-plan computation time (ms). */
export function recordRoutePlan(durationMs: number): void {
  metrics.observeHistogram(ROUTE_PLAN_DURATION_MS, {}, durationMs);
}
