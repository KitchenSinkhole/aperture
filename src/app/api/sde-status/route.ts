import 'server-only';
import { getSession } from '@/lib/session';
import { getSdeStatus } from '@/lib/sde/status';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/sde-status
 * Static-data health for the layout banner's refetch. Instance-wide, not
 * map-scoped, so any signed-in character may read it; 401 when logged out.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiMetrics('/api/sde-status', async function GET() {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  return Response.json({ ok: true, data: await getSdeStatus() });
});
