import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { deleteDisconnected } from '@/lib/map/mutations/subchain';
import { applyHomeStaticExemption } from '@/lib/tagging/exemption';
import { logger } from '@/lib/log/logger';
import { requireMapMutate } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/disconnected — delete every visible system with no path
 * back to the map's Home (see `@/lib/map/subchainGraph` `computeDisconnected`).
 * Hard-deletes the touched connections and soft-deletes the systems in one
 * transaction, returning the N committed event payloads:
 * `{ ok, data: { summary, payloads }, eventId: 0 }`. Consumers read
 * `data.payloads[].eventId`. Takes no body — the server derives the set from the
 * map's Home and live graph.
 *
 * Access: `map_update` right on the target map.
 */

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/disconnected', async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const result = await deleteDisconnected({
    mapId: guard.mapId,
    characterId: guard.characterId,
  });

  // A removed branch may take the Home static target with it (or sever the
  // home-static link), so reconcile the ABC exemption once. No-op for non-ABC
  // maps. Tagging failures never fail the delete.
  if (result.ok) {
    try {
      await applyHomeStaticExemption(guard.mapId, guard.characterId);
    } catch (err) {
      logger.warn('home-static exemption reconcile failed', { mapId: guard.mapId.toString(), err });
    }
  }

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
