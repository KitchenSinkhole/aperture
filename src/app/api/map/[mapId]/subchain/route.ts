import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { deleteSubchain } from '@/lib/map/mutations/subchain';
import { applyHomeStaticExemption } from '@/lib/tagging/exemption';
import { logger } from '@/lib/log/logger';
import { parseBigInt, requireMapMutate } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/subchain — delete a head system and its orphaned branch
 * (head + everything cut off from the keep-side anchor; see
 * `@/lib/map/subchainGraph`). Hard-deletes the touched connections and
 * soft-deletes the systems in one transaction, returning the N committed event
 * payloads: `{ ok, data: { summary, payloads }, eventId: 0 }`. Consumers read
 * `data.payloads[].eventId`.
 *
 * The anchor is the map's Home when set; otherwise `anchorMapSystemId` (a
 * neighbour of the head to keep) is required.
 *
 * Access: `map_update` right on the target map.
 */

const subchainBodySchema = z.object({
  headMapSystemId: z.string().regex(/^\d+$/),
  anchorMapSystemId: z
    .string()
    .regex(/^\d+$/)
    .nullable()
    .optional(),
});

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/subchain', async function POST(
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

  const parsed = subchainBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const headMapSystemId = parseBigInt(parsed.data.headMapSystemId);
  if (!headMapSystemId)
    return Response.json({ ok: false, error: 'Invalid system id.' }, { status: 400 });

  let anchorMapSystemId: bigint | null = null;
  if (parsed.data.anchorMapSystemId != null) {
    anchorMapSystemId = parseBigInt(parsed.data.anchorMapSystemId);
    if (!anchorMapSystemId)
      return Response.json({ ok: false, error: 'Invalid keep-side system id.' }, { status: 400 });
  }

  const result = await deleteSubchain({
    mapId: guard.mapId,
    headMapSystemId,
    anchorMapSystemId,
    characterId: guard.characterId,
  });

  // Removing a branch may take the Home static target with it (or sever the
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
