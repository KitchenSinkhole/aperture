import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { pingSystem } from '@/lib/map/ping';
import { parseBigInt, requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/ping — broadcast a transient "ping" pulse on a system to
 * every client viewing the map. This is **not** a mutation: it writes no row and
 * emits no `ap_map_event`; it fans a direct `systemNotification` (kind `ping`)
 * via `pingSystem` (see `src/lib/map/ping.ts`). Returns `{ ok }` — the caller
 * needs no echo data; the underglow arrives over realtime like everyone else's.
 *
 * Access: `map_view` (the lowest bar). Pinging creates no persistent state and
 * is part of live fleet coordination, so any viewer may do it; tighten to
 * `requireMapMutate(..., 'map_update')` here if a deployment needs to.
 *
 * Body: `{ mapSystemId }` (`ap_map_system.id`). The system is resolved to its
 * EVE solar-system id and verified on the map server-side; a 404 means it isn't.
 */

const pingBodySchema = z.object({
  mapSystemId: z.string().regex(/^\d+$/),
});

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/ping', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = pingBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const mapSystemId = parseBigInt(parsed.data.mapSystemId);
  if (!mapSystemId)
    return Response.json({ ok: false, error: 'Invalid system id.' }, { status: 400 });

  const result = await pingSystem({ mapId: guard.mapId, mapSystemId });
  return Response.json(result, { status: result.ok ? 200 : 404 });
});
