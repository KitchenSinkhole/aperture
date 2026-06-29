import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { addSystemWithStargateLinks } from '@/lib/map/mutations/systems';
import { requireMapMutate } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/systems
 * Add a solar system to a map. Body: { systemId, positionX?, positionY? }.
 * Returns { ok, data: { payloads }, eventId: 0 } — the `system.added` event plus
 * any auto-created `stargate` connection events (gate links to systems already
 * on the map). Consumers fold `data.payloads` like a bulk paste.
 *
 * Access: `map_update` right on the target map.
 */

const addSystemBodySchema = z.object({
  systemId: z.number().int().positive(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/systems', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = addSystemBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const result = await addSystemWithStargateLinks({
    mapId: guard.mapId,
    characterId: guard.characterId,
    systemId: parsed.data.systemId,
    positionX: parsed.data.positionX,
    positionY: parsed.data.positionY,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
