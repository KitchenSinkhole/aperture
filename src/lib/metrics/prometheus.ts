import type { GaugeReadings, MetricLabels, MetricsSnapshot } from '@/types';

/**
 * Render the metrics registry snapshot plus the instantaneous gauges into the
 * Prometheus text exposition format (v0.0.4). Pure string assembly — the only
 * consumer is `/api/metrics`; Prometheus owns retention, so nothing is stored.
 *
 * No `server-only` import (it's a leaf formatter), no Prometheus client lib:
 * the registry already keeps cumulative `le` bucket counts in the shape the
 * format wants.
 */

/**
 * Gauge metadata — the bridge from the flat `GaugeReadings` record to named
 * Prometheus gauges. Order is the emission order. Names follow Prometheus
 * conventions (`*_bytes`, `*_ms`) so a generic dashboard reads them correctly.
 */
const GAUGE_METRICS: ReadonlyArray<{ key: keyof GaugeReadings; name: string; help: string }> = [
  { key: 'trackedCharacters', name: 'tracked_characters', help: 'Characters with server-side location tracking.' },
  { key: 'visibleSystems', name: 'visible_systems', help: 'Systems currently visible across all maps.' },
  { key: 'wsConnections', name: 'ws_connections', help: 'Active realtime WebSocket connections.' },
  { key: 'openEsiBreakers', name: 'esi_breakers_open', help: 'ESI circuit breakers currently open.' },
  { key: 'jobBacklog', name: 'job_backlog', help: 'Runnable background jobs waiting for a worker.' },
  { key: 'jobsAbandoned', name: 'jobs_abandoned', help: 'Job runs that never recorded an end (worker died mid-job).' },
  { key: 'dbPoolTotal', name: 'db_pool_total_connections', help: 'Total connections in the Postgres pool (in use + idle).' },
  { key: 'dbPoolIdle', name: 'db_pool_idle_connections', help: 'Idle connections in the Postgres pool.' },
  { key: 'dbPoolWaiting', name: 'db_pool_waiting_connections', help: 'Requests waiting for a Postgres pool connection.' },
  { key: 'processRssBytes', name: 'process_resident_memory_bytes', help: 'Resident set size of the Node process in bytes.' },
  { key: 'processHeapUsedBytes', name: 'process_heap_used_bytes', help: 'V8 heap used in bytes.' },
  { key: 'processHeapTotalBytes', name: 'process_heap_total_bytes', help: 'V8 heap total in bytes.' },
  { key: 'eventLoopLagMs', name: 'event_loop_lag_ms', help: 'Mean event-loop delay since the previous scrape, in milliseconds.' },
];

/** `# HELP` text escaping: backslash and newline only (quotes are literal here). */
function escapeHelp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/** Label-value escaping: backslash, newline, and double-quote. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/** A finite number as a Prometheus sample value; non-finite collapses to `0`. */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function formatLabels(labels: MetricLabels, extra?: { name: string; value: string }): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  if (extra) parts.push(`${extra.name}="${escapeLabelValue(extra.value)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

export function renderPrometheus(snapshot: MetricsSnapshot, gauges: GaugeReadings): string {
  const lines: string[] = [];

  for (const counter of snapshot.counters) {
    lines.push(`# HELP ${counter.name} ${escapeHelp(counter.help)}`);
    lines.push(`# TYPE ${counter.name} counter`);
    for (const s of counter.series) {
      lines.push(`${counter.name}${formatLabels(s.labels)} ${formatNumber(s.value)}`);
    }
  }

  for (const h of snapshot.histograms) {
    lines.push(`# HELP ${h.name} ${escapeHelp(h.help)}`);
    lines.push(`# TYPE ${h.name} histogram`);
    for (const s of h.series) {
      for (let i = 0; i < h.buckets.length; i++) {
        const le = formatNumber(h.buckets[i]!);
        lines.push(`${h.name}_bucket${formatLabels(s.labels, { name: 'le', value: le })} ${formatNumber(s.counts[i]!)}`);
      }
      // The implicit +Inf bucket equals the total observation count.
      lines.push(`${h.name}_bucket${formatLabels(s.labels, { name: 'le', value: '+Inf' })} ${formatNumber(s.count)}`);
      lines.push(`${h.name}_sum${formatLabels(s.labels)} ${formatNumber(s.sum)}`);
      lines.push(`${h.name}_count${formatLabels(s.labels)} ${formatNumber(s.count)}`);
    }
  }

  for (const g of GAUGE_METRICS) {
    lines.push(`# HELP ${g.name} ${escapeHelp(g.help)}`);
    lines.push(`# TYPE ${g.name} gauge`);
    lines.push(`${g.name} ${formatNumber(gauges[g.key])}`);
  }

  // Exposition format wants a trailing newline.
  return lines.join('\n') + '\n';
}
