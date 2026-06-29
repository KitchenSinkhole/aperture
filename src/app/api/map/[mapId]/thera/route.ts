import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { loadTheraConnections } from '@/lib/map/thera';
import { EveScoutError } from '@/lib/integrations/evescout';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/thera — current EVE-Scout Thera + Turnur connections,
 * oriented + enriched with the target system's class. Returns `{ ok, data }`
 * (a read; no `eventId`). Server-side proxy so the browser doesn't hit EVE-Scout
 * directly (CORS) and so the result is fronted by the module's TTL cache.
 *
 * Access: view rights on the target map (the module is map-scoped UI; the
 * underlying EVE-Scout data is public).
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/thera', async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  try {
    const data = await loadTheraConnections();
    return Response.json({ ok: true, data });
  } catch (err) {
    const status = err instanceof EveScoutError ? 502 : 500;
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'EVE-Scout request failed.' },
      { status },
    );
  }
});
