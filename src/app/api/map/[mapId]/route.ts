import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { loadMapForView } from '@/lib/map/loadMap';
import { requireMapView } from '../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]
 * Returns the full authoritative map view snapshot (`MapViewData`) — the same
 * shape the server component feeds `MapCanvas` at mount. Used by the client's
 * on-error resync failsafe to heal local state drift against DB truth.
 *
 * Access: view-only — anyone who can see the map may read its snapshot.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId', async function GET(_request: NextRequest, { params }: { params: Promise<{ mapId: string }> }) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const data = await loadMapForView(guard.mapId, guard.characterId);
  if (!data) {
    return Response.json({ ok: false, error: 'Map not found.' }, { status: 404 });
  }

  return Response.json({ ok: true, data });
});
