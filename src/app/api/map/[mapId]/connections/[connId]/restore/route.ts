import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { restoreConnection } from '@/lib/map/mutations/restoreConnection';
import { parseBigInt, requireMapMutate } from '../../../../utils';

/**
 * POST /api/map/[mapId]/connections/[connId]/restore — re-confirm a dormant
 * wormhole connection and re-activate any hidden endpoint (Stage 4 sig-memory
 * restore). Body-less. Returns the committed event payloads:
 * `{ ok, data: { payloads }, eventId: 0 }` — consumers fold `data.payloads`.
 *
 * Access: `map_update` right on the target map.
 */

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string; connId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, connId: rawConnId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const connectionId = parseBigInt(rawConnId);
  if (!connectionId)
    return Response.json({ ok: false, error: 'Invalid connection id.' }, { status: 400 });

  const result = await restoreConnection({
    mapId: guard.mapId,
    connectionId,
    characterId: guard.characterId,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
