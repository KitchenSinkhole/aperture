import { deepHealth } from '@/lib/health/probe';

/**
 * GET /api/health/ready
 *
 * Deep readiness probe — JSON component map (db, realtimeBus, worker, esi,
 * migrations) plus an overall status. 503 iff the overall status is `down`
 * (a critical component is out), else 200. Public (no auth), no PII in the
 * payload — feeds the external monitor, alerting (Phase 6), and status pages.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await deepHealth();
  return Response.json(report, { status: report.status === 'down' ? 503 : 200 });
}
