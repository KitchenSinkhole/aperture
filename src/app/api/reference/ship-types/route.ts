import 'server-only';
import { getSession } from '@/lib/session';
import { shipTypeGroups } from '@/lib/eve/shipTypes';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/reference/ship-types
 * Every published Ship-category type id with its SDE group, so the overlay can
 * tell ships from everything else a D-Scan lists alongside them — capsules
 * count as ships, being in that category. Static reference data — not
 * map-scoped, so any signed-in character may read it; 401 when logged out.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/reference/ship-types', async function GET() {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const data = await shipTypeGroups();
  return Response.json({ ok: true, data });
});
