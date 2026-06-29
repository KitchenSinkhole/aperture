import 'server-only';
import { type NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter } from '@/db/schema';
import { getSession } from '@/lib/session';
import { getMapViewerUserIds } from '@/lib/realtime/mapViewers';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/viewers — the EVE character ids whose *account* currently
 * has this map open in a live WebSocket. Reads the connected account ids from
 * the in-process `mapViewers` roster (`src/lib/realtime/mapViewers.ts`, kept by
 * the WS server) and expands each to every character that account owns, because
 * a human with the map open can see all of their alts move (coverage is
 * account-level, not character-level).
 *
 * **Not** the same as the online-pilot roster: location tracking runs
 * server-side whether or not a tab is open, so a pilot can be online (and on the
 * roster) while their account isn't viewing the map here. The pilot roster
 * popover polls this to flag those pilots.
 *
 * Access: `map_view` — any viewer may see who else has the map open.
 * Returns `{ ok, characterIds }`.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/viewers', async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const userIds = getMapViewerUserIds(guard.mapId);
  if (userIds.length === 0) {
    return Response.json({ ok: true, characterIds: [] });
  }

  const rows = await db
    .select({ id: apCharacter.id })
    .from(apCharacter)
    .where(inArray(apCharacter.userId, userIds));

  // EVE character ids fit comfortably in Number.MAX_SAFE_INTEGER (the wire
  // convention everywhere else), and the roster keys on number.
  return Response.json({ ok: true, characterIds: rows.map((r) => Number(r.id)) });
});
