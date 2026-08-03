import { apertureConfig } from '../../../aperture.config';
import { env } from '@/lib/env';
import type {
  CounterSnapshot,
  EsiMetricOutcome,
  HistogramSnapshot,
  JobOutcome,
  JwkRefreshOutcome,
  LocationPollOutcome,
  MetricLabels,
  MetricsSnapshot,
  PublicWsUpgradeOutcome,
  TokenRefreshOutcome,
  WebhookOutcome,
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

// --- Phase 8: deepened instrumentation ---

/** Counter: map mutations committed, by event `kind` (`map_events_total{task}`). */
export const MAP_EVENTS_TOTAL = 'map_events_total';
/** Counter: realtime envelopes fanned out, by task vocabulary. */
export const REALTIME_BROADCASTS_TOTAL = 'realtime_broadcasts_total';
/** Counter: `pg_notify` notifications received, by bounded channel-class. */
export const PG_NOTIFY_RECEIVED_TOTAL = 'pg_notify_received_total';
/** Counter: Aperture HTTP requests, by bounded route template + method + status. */
export const HTTP_REQUESTS_TOTAL = 'http_requests_total';
/** Counter: background job runs, by task + outcome. */
export const JOB_RUNS_TOTAL = 'job_runs_total';
/** Counter: location-poll invocations, by bounded outcome. */
export const LOCATION_POLLS_TOTAL = 'location_polls_total';
/** Counter: recorded wormhole jumps (label-free volume). */
export const CHARACTER_JUMPS_TOTAL = 'character_jumps_total';
/** Counter: persisted error-log rows, by source. */
export const ERROR_LOG_EVENTS_TOTAL = 'error_log_events_total';
/** Counter: webhook deliveries, by target + outcome. */
export const WEBHOOK_DELIVERIES_TOTAL = 'webhook_deliveries_total';
/** Counter: ESI token refreshes, by outcome. */
export const ESI_TOKEN_REFRESH_TOTAL = 'esi_token_refresh_total';
/** Counter: genuine remote JWKS fetches (cache refreshes), by outcome. */
export const JWK_CACHE_REFRESH_TOTAL = 'jwk_cache_refresh_total';
/** Counter: public spectator WebSocket upgrade handshakes, by outcome. */
export const PUBLIC_WS_UPGRADES_TOTAL = 'public_ws_upgrades_total';

/** Histogram: in-process realtime dispatch→deliver span. */
export const REALTIME_FANOUT_DURATION_MS = 'realtime_fanout_duration_ms';
/** Histogram: Aperture HTTP request latency, by bounded route template. */
export const HTTP_REQUEST_DURATION_MS = 'http_request_duration_ms';
/** Histogram: background job run duration, by task. */
export const JOB_DURATION_MS = 'job_duration_ms';

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

    // Phase 8 — deepened instrumentation.
    this.defineCounter(MAP_EVENTS_TOTAL, 'Map mutations committed, by event kind.');
    this.defineCounter(REALTIME_BROADCASTS_TOTAL, 'Realtime envelopes fanned out, by task.');
    this.defineCounter(PG_NOTIFY_RECEIVED_TOTAL, 'pg_notify notifications received, by channel class.');
    this.defineCounter(HTTP_REQUESTS_TOTAL, 'Aperture HTTP requests, by route, method and status.');
    this.defineCounter(JOB_RUNS_TOTAL, 'Background job runs, by task and outcome.');
    this.defineCounter(LOCATION_POLLS_TOTAL, 'Location-poll invocations, by outcome.');
    this.defineCounter(CHARACTER_JUMPS_TOTAL, 'Recorded wormhole jumps.');
    this.defineCounter(ERROR_LOG_EVENTS_TOTAL, 'Persisted error-log rows, by source.');
    this.defineCounter(WEBHOOK_DELIVERIES_TOTAL, 'Webhook deliveries, by target and outcome.');
    this.defineCounter(ESI_TOKEN_REFRESH_TOTAL, 'ESI token refreshes, by outcome.');
    this.defineCounter(JWK_CACHE_REFRESH_TOTAL, 'Remote JWKS cache refreshes, by outcome.');
    this.defineCounter(
      PUBLIC_WS_UPGRADES_TOTAL,
      'Public spectator WebSocket upgrade handshakes, by outcome.',
    );
    this.defineHistogram(
      REALTIME_FANOUT_DURATION_MS,
      'In-process realtime dispatch-to-deliver span in milliseconds.',
      apertureConfig.METRICS_FANOUT_LATENCY_BUCKETS_MS,
    );
    this.defineHistogram(
      HTTP_REQUEST_DURATION_MS,
      'Aperture HTTP request latency in milliseconds.',
      apertureConfig.METRICS_HTTP_LATENCY_BUCKETS_MS,
    );
    this.defineHistogram(
      JOB_DURATION_MS,
      'Background job run duration in milliseconds.',
      apertureConfig.METRICS_JOB_DURATION_BUCKETS_MS,
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

/** Tally one Aperture HTTP request (counter + latency histogram). */
export function recordHttpRequest(
  route: string,
  method: string,
  status: string,
  durationMs: number,
): void {
  metrics.incrementCounter(HTTP_REQUESTS_TOTAL, { route, method, status });
  metrics.observeHistogram(HTTP_REQUEST_DURATION_MS, { route }, durationMs);
}

/** Tally one background job run (counter by outcome + duration histogram). */
export function recordJobRun(task: string, outcome: JobOutcome, durationMs: number): void {
  metrics.incrementCounter(JOB_RUNS_TOTAL, { task, outcome });
  metrics.observeHistogram(JOB_DURATION_MS, { task }, durationMs);
}

/** Tally one realtime broadcast (counter by task + in-process fanout duration). */
export function recordRealtimeBroadcast(task: string, durationMs: number): void {
  metrics.incrementCounter(REALTIME_BROADCASTS_TOTAL, { task });
  metrics.observeHistogram(REALTIME_FANOUT_DURATION_MS, {}, durationMs);
}

/** Tally one committed map event (`map_events_total{task}`). */
export function recordMapEvent(task: string): void {
  metrics.incrementCounter(MAP_EVENTS_TOTAL, { task });
}

/** Tally one location-poll invocation by bounded outcome. */
export function recordLocationPoll(outcome: LocationPollOutcome): void {
  metrics.incrementCounter(LOCATION_POLLS_TOTAL, { outcome });
}

/** Tally one recorded wormhole jump (label-free volume). */
export function recordCharacterJump(): void {
  metrics.incrementCounter(CHARACTER_JUMPS_TOTAL, {});
}

/** Tally one Discord webhook delivery by outcome. */
export function recordWebhookDelivery(outcome: WebhookOutcome): void {
  metrics.incrementCounter(WEBHOOK_DELIVERIES_TOTAL, { target: 'discord', outcome });
}

/** Tally one ESI token-refresh exchange by outcome. */
export function recordTokenRefresh(outcome: TokenRefreshOutcome): void {
  metrics.incrementCounter(ESI_TOKEN_REFRESH_TOTAL, { outcome });
}

/** Tally one genuine remote JWKS fetch (cache refresh) by outcome. */
export function recordJwkRefresh(outcome: JwkRefreshOutcome): void {
  metrics.incrementCounter(JWK_CACHE_REFRESH_TOTAL, { outcome });
}

/** Tally one public spectator WebSocket upgrade handshake by outcome. */
export function recordPublicWsUpgrade(outcome: PublicWsUpgradeOutcome): void {
  metrics.incrementCounter(PUBLIC_WS_UPGRADES_TOTAL, { outcome });
}
