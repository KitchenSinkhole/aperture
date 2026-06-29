import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { createConnection } from '@/lib/map/mutations/connections';
import { updateSystem } from '@/lib/map/mutations/systems';
import { assignTagOnConnect } from '@/lib/tagging/service';
import { logger } from '@/lib/log/logger';
import { connectionScope, eolStage, whJumpMass, whMass } from '@/db/schema/ap/enums';
import { parseBigInt, requireMapMutate } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/connections
 * Create a connection between two map systems.
 * Returns { ok, data, eventId }.
 *
 * Access: `map_update` right on the target map.
 */

const createConnectionBodySchema = z.object({
  sourceMapSystemId: z.string().regex(/^\d+$/),
  targetMapSystemId: z.string().regex(/^\d+$/),
  scope: z.enum(connectionScope.enumValues),
  massStatus: z.enum(whMass.enumValues).optional(),
  jumpMassClass: z.enum(whJumpMass.enumValues).nullable().optional(),
  eolStage: z.enum(eolStage.enumValues).optional(),
  preserveMass: z.boolean().optional(),
  isRolling: z.boolean().optional(),
  isStatic: z.boolean().optional(),
});

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/connections', async function POST(
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

  const parsed = createConnectionBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const sourceId = parseBigInt(parsed.data.sourceMapSystemId);
  const targetId = parseBigInt(parsed.data.targetMapSystemId);
  if (!sourceId || !targetId) {
    return Response.json({ ok: false, error: 'Invalid system id.' }, { status: 400 });
  }

  const result = await createConnection({
    mapId: guard.mapId,
    characterId: guard.characterId,
    sourceMapSystemId: sourceId,
    targetMapSystemId: targetId,
    scope: parsed.data.scope,
    massStatus: parsed.data.massStatus,
    jumpMassClass: parsed.data.jumpMassClass,
    eolStage: parsed.data.eolStage,
    preserveMass: parsed.data.preserveMass,
    isRolling: parsed.data.isRolling,
    isStatic: parsed.data.isStatic,
  });

  // Auto-tagging: on a 0121 map a new edge may root an untagged
  // child to its now-known parent. Emit the tag as a separate `system.updated`
  // event (the WS echo folds it onto every client). No-op for ABC / unscheme'd
  // maps. Tagging failures never fail the connection itself.
  if (result.ok) {
    try {
      const tagged = await assignTagOnConnect(guard.mapId, sourceId, targetId);
      if (tagged) {
        await updateSystem({
          mapId: guard.mapId,
          mapSystemId: tagged.mapSystemId,
          characterId: guard.characterId,
          patch: { tag: tagged.tag },
        });
      }
    } catch (err) {
      logger.warn('auto-tag on connect failed', { mapId: guard.mapId.toString(), err });
    }
  }

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
