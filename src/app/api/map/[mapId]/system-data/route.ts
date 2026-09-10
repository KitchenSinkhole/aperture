import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { intelForSystems } from '@/lib/map/intel';
import { statsForSystems } from '@/lib/map/stats';
import { structuresForSystems } from '@/lib/structures/read';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/system-data?systems=<id>,<id>,...
 * Batched read-side per-system data (sov / FW / incursion intel + 24h activity
 * stats + structure intel) keyed by EVE solar-system id. The map page
 * server-renders this for the systems present at load; the client calls here to
 * backfill systems added live (paste, tracked-pilot jump, manual add) so their
 * decorators and sidebar modules fill in without a page reload.
 *
 * Access: view-only — anyone who can see the map may read it. The `systems`
 * param is not checked against the map's own systems, so structure intel is
 * additionally filtered to the rows the guarded character's scope admits, and is
 * empty entirely for a guest on this map: a sweep of arbitrary system ids returns
 * only structures the caller could already see. Sov/FW/incursion intel and
 * activity stats are public universe data and carry no such filter.
 */

export const runtime = 'nodejs';

const MAX_SYSTEMS = 256;

export const GET = withApiMetrics('/api/map/:mapId/system-data', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const raw = request.nextUrl.searchParams.get('systems');
  if (!raw) {
    return Response.json({ ok: false, error: 'systems query param required.' }, { status: 400 });
  }
  const systemIds = [
    ...new Set(
      raw
        .split(',')
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (systemIds.length === 0) {
    return Response.json({ ok: false, error: 'No valid system ids.' }, { status: 400 });
  }
  if (systemIds.length > MAX_SYSTEMS) {
    return Response.json(
      { ok: false, error: `Too many systems (max ${MAX_SYSTEMS}).` },
      { status: 400 },
    );
  }

  const [intel, stats, structures] = await Promise.all([
    intelForSystems(systemIds),
    statsForSystems(systemIds),
    structuresForSystems(guard.mapId, systemIds, guard.characterId),
  ]);

  return Response.json({ ok: true, data: { intel, stats, structures } });
});
