import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { buildMapExport } from '@/lib/map/transfer';
import { requireMapCapability } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/export — serialise the map's current state to a
 * `MapExportFile` JSON document. Returns `{ ok: true, data }` (no `eventId`;
 * this is a read). The client builds the download so it can name the file.
 *
 * Access: the `map_export` capability (manager implicitly, or a delegated corp
 * title).
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/export', async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapCapability(rawMapId, session, 'map_export');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  try {
    const data = await buildMapExport(guard.mapId);
    return Response.json({ ok: true, data });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Export failed.' },
      { status: 500 },
    );
  }
});
