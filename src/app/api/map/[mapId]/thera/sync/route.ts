import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { syncTheraConnections } from '@/lib/map/thera';
import { requireMapMutate } from '../../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/thera/sync — fold the chosen EVE-Scout connections onto
 * the map. Returns the committed event payloads (`{ ok, data: { summary,
 * payloads }, eventId: 0 }`) so the client folds + dedupes, like the bulk-paste
 * / import paths.
 *
 * Access: `map_update` right (same as creating a connection by hand — a
 * `map_update` user could place these edges manually anyway). Client-passed
 * system ids are FK-checked against `universe_system`.
 */

const bodySchema = z.object({
  connections: z
    .array(
      z.object({
        hubSystemId: z.number().int(),
        hubName: z.string(),
        targetSystemId: z.number().int(),
        signatureId: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/thera/sync', async function POST(
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const result = await syncTheraConnections({
    mapId: guard.mapId,
    characterId: guard.characterId,
    connections: parsed.data.connections,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
