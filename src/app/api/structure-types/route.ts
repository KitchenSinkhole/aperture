import 'server-only';
import { getSession } from '@/lib/session';
import { upwellStructureTypes } from '@/lib/structures/read';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/structure-types — the placeable Upwell structure types for the
 * structure create/edit picker. Static SDE reference data; any authenticated
 * user may read it (like `/api/map/[mapId]/wormhole-types`).
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/structure-types', async function GET() {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }
  const data = await upwellStructureTypes();
  return Response.json({ ok: true, data });
});
