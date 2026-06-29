import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { wormholeTypesForSystem } from '@/lib/map/wormholeTypes';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/wormhole-types?systemId=<universeSystemId>
 * Returns wormhole type options filtered to the given system's class — fed by
 * the wormhole-type dropdown in the signature inspector.
 *
 * Access: view-only — anyone who can see the map may read the WH catalog.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/wormhole-types', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const rawSystemId = request.nextUrl.searchParams.get('systemId');
  if (!rawSystemId || !/^\d+$/.test(rawSystemId)) {
    return Response.json({ ok: false, error: 'systemId query param required.' }, { status: 400 });
  }
  const systemId = Number(rawSystemId);
  if (!Number.isInteger(systemId) || systemId <= 0) {
    return Response.json({ ok: false, error: 'Invalid systemId.' }, { status: 400 });
  }

  const types = await wormholeTypesForSystem(systemId);
  return Response.json({ ok: true, data: types });
});
