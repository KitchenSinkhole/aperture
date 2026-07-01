import { shallowHealth } from '@/lib/health/probe';

/**
 * GET /api/health
 *
 * Shallow liveness probe — cheap `SELECT 1`, the external uptime monitor's
 * target. 200 `{ status: 'ok' }` when the DB answers, 503 `{ status: 'down' }`
 * otherwise. Public (no auth): the external monitor has no credentials.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ok = await shallowHealth();
  return Response.json({ status: ok ? 'ok' : 'down' }, { status: ok ? 200 : 503 });
}
