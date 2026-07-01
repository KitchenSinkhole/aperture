import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { searchSystems } from '@/lib/map/systemSearch';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/system-search?q=<query>
 * Solar-system name search feeding the "add system manually" dialog. Returns
 * `{ ok, data: SystemSearchResult[] }`.
 *
 * Access: view-only — anyone who can see the map may search the universe. The
 * actual add still goes through POST /systems (`map_update`).
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/system-search', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const query = request.nextUrl.searchParams.get('q') ?? '';
  const data = await searchSystems(query);
  return Response.json({ ok: true, data });
});
