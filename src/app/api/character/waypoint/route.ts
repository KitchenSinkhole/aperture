import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession, assertCharacterOwnership } from '@/lib/session';
import { esiCall, EsiHttpError, EsiTokenError } from '@/lib/esi/client';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/character/waypoint — append an on-map system as an autopilot
 * waypoint on one of the signed-in user's own characters (the map's "active"
 * character). Writes no map event: this is a side-effect call into the EVE
 * client via ESI, not a map mutation.
 *
 * Requires the `esi-ui.write_waypoint.v1` scope. A token that predates the
 * scope (401/403) surfaces a re-login prompt rather than a generic failure.
 */

export const runtime = 'nodejs';

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  destinationId: z.number().int().positive(),
});

export const POST = withApiMetrics('/api/character/waypoint', async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'You must be signed in.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const { characterId, destinationId } = parsed.data;
  const owns = await assertCharacterOwnership(BigInt(characterId), session.userId);
  if (!owns) {
    return Response.json({ ok: false, error: 'That character is not yours.' }, { status: 403 });
  }

  try {
    await esiCall('setWaypoint', {
      schema: z.null(),
      characterId: BigInt(characterId),
      query: {
        destination_id: destinationId,
        add_to_beginning: false,
        clear_other_waypoints: false,
      },
    });
    return Response.json({ ok: true });
  } catch (err) {
    if (
      err instanceof EsiTokenError ||
      (err instanceof EsiHttpError && (err.status === 401 || err.status === 403))
    ) {
      return Response.json(
        { ok: false, error: 'Sign out and back in to enable Set destination.' },
        { status: 400 },
      );
    }
    return Response.json(
      { ok: false, error: 'Set destination is unavailable right now.' },
      { status: 502 },
    );
  }
});
