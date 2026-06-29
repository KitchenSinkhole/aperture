import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { sampleGauges } from '@/lib/metrics/gauges';
import { renderPrometheus } from '@/lib/metrics/prometheus';
import { metrics } from '@/lib/metrics/registry';

/**
 * GET /api/metrics
 *
 * Prometheus scrape target — the registry's cumulative counters/histograms plus
 * gauges sampled at request time, rendered in text exposition format. Opt-in:
 * 404 unless `METRICS_ENABLED`, 401 without a matching `METRICS_TOKEN` (Bearer
 * header or `?token=`). Self-hosters opt in; the public deployment sets a token.
 *
 * Node runtime — gauges read the DB pool and `process.memoryUsage()`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!env.METRICS_ENABLED) {
    return new Response('Not found\n', { status: 404 });
  }
  if (!tokenMatches(extractToken(request))) {
    return new Response('Unauthorized\n', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
  }

  const gauges = await sampleGauges();
  const body = renderPrometheus(metrics.snapshot(), gauges);
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' },
  });
}

function extractToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  return new URL(request.url).searchParams.get('token');
}

/** Constant-time token comparison. An empty configured token matches nothing. */
function tokenMatches(provided: string | null): boolean {
  const expected = env.METRICS_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
