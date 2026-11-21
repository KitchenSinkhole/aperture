import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { listConnectionMassLog } from '@/lib/map/connectionMassLog';
import { getBlackoutStatus, isBlackedOut } from '@/lib/auth/blackout';
import { parseBigInt, requireMapView } from '../../../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/connections/[connId]/mass-log — list a connection's
 * per-jump mass-log (newest first, with running cumulative mass).
 *
 * Read-only: the log is server-derived from the location-poll;
 * there is no POST/DELETE. Access: view right on the target map.
 *
 * While Blackout restricts the viewer the log is withheld whole: `data` is
 * empty and `hidden: true` tells the inspector why.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/connections/:connId/mass-log', async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string; connId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, connId: rawConnId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const connectionId = parseBigInt(rawConnId);
  if (!connectionId) {
    return Response.json({ ok: false, error: 'Invalid connection id.' }, { status: 400 });
  }

  if (isBlackedOut(await getBlackoutStatus(session!.userId))) {
    return Response.json({ ok: true, data: [], hidden: true });
  }

  const data = await listConnectionMassLog({ mapId: guard.mapId, connectionId });
  return Response.json({ ok: true, data });
});
