import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { planRoutes } from '@/lib/map/routePlanner';
import { routePrefsSchema } from '@/lib/map/routePrefs';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/route-plan
 * routes-module compute endpoint. Body: `{ sourceSystemId, destinationSystemIds, prefs }`.
 * Returns `{ ok, data: RoutePlan[] }` — one plan per destination, in input order.
 *
 * Read-only: computes over the cached gate graph + this map's live wormhole
 * overlay (+ optional EVE-Scout); no DB writes, no `ap_map_event`. A JSON API
 * route rather than a Server Action because it's a high-frequency recompute that
 * returns data. Access: view-only on the map. Prefs ride in the body so the UI
 * can preview setting tweaks before they're persisted.
 */

export const runtime = 'nodejs';

const bodySchema = z.object({
  sourceSystemId: z.number().int().positive(),
  destinationSystemIds: z.array(z.number().int().positive()).max(50),
  prefs: routePrefsSchema,
});

export const POST = withApiMetrics('/api/map/:mapId/route-plan', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const data = await planRoutes({
    mapId: guard.mapId,
    sourceSystemId: parsed.sourceSystemId,
    destinationSystemIds: parsed.destinationSystemIds,
    prefs: parsed.prefs,
  });
  return Response.json({ ok: true, data });
});
