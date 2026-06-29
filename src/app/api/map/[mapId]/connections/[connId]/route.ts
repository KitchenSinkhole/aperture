import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { deleteConnection, updateConnection } from '@/lib/map/mutations/connections';
import { applyHomeStaticExemption } from '@/lib/tagging/exemption';
import { logger } from '@/lib/log/logger';
import { connectionScope, eolStage, whJumpMass, whMass } from '@/db/schema/ap/enums';
import { parseBigInt, requireMapMutate } from '../../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * PATCH /api/map/[mapId]/connections/[connId] — update a connection's flags.
 * DELETE /api/map/[mapId]/connections/[connId] — hard-delete (wormholes don't come back).
 *
 * Access: `map_update` right on the target map.
 */

const updateConnectionBodySchema = z.object({
  scope: z.enum(connectionScope.enumValues).optional(),
  massStatus: z.enum(whMass.enumValues).optional(),
  jumpMassClass: z.enum(whJumpMass.enumValues).nullable().optional(),
  eolStage: z.enum(eolStage.enumValues).optional(),
  preserveMass: z.boolean().optional(),
  isRolling: z.boolean().optional(),
  isStatic: z.boolean().optional(),
});

export const runtime = 'nodejs';

export const PATCH = withApiMetrics('/api/map/:mapId/connections/:connId', async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string; connId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, connId: rawConnId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const connectionId = parseBigInt(rawConnId);
  if (!connectionId) return Response.json({ ok: false, error: 'Invalid connection id.' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = updateConnectionBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const result = await updateConnection({
    mapId: guard.mapId,
    connectionId,
    characterId: guard.characterId,
    patch: parsed.data,
  });

  // Toggling `isStatic` on a Home-touching link changes which system is the
  // Home static target — reconcile the ABC exemption as separate `system.update`
  // events. No-op for non-ABC maps. Tagging failures never fail the connection.
  if (result.ok && parsed.data.isStatic !== undefined) {
    try {
      await applyHomeStaticExemption(guard.mapId, guard.characterId);
    } catch (err) {
      logger.warn('home-static exemption reconcile failed', { mapId: guard.mapId.toString(), err });
    }
  }

  return Response.json(result, { status: result.ok ? 200 : 400 });
});

export const DELETE = withApiMetrics('/api/map/:mapId/connections/:connId', async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string; connId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, connId: rawConnId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const connectionId = parseBigInt(rawConnId);
  if (!connectionId) return Response.json({ ok: false, error: 'Invalid connection id.' }, { status: 400 });

  const result = await deleteConnection({
    mapId: guard.mapId,
    connectionId,
    characterId: guard.characterId,
  });

  // Deleting the Home static drops the exemption → the target re-tags. Reconcile
  // reads fresh state (the row is already gone). No-op for non-ABC maps.
  if (result.ok) {
    try {
      await applyHomeStaticExemption(guard.mapId, guard.characterId);
    } catch (err) {
      logger.warn('home-static exemption reconcile failed', { mapId: guard.mapId.toString(), err });
    }
  }

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
