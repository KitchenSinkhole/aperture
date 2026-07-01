import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { deleteSignature, updateSignature } from '@/lib/map/mutations/signatures';
import { eolStage, signatureActivity, signatureClassKind, signatureGroupKey } from '@/db/schema';
import { parseBigInt, requireMapMutate } from '../../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * PATCH /api/map/[mapId]/signatures/[sigId] — update a signature's fields.
 * DELETE /api/map/[mapId]/signatures/[sigId] — hard-delete a signature.
 *
 * [sigId] is `ap_map_signature.id` (the DB row id), NOT the in-game 3-char sig code.
 *
 * Access: `map_update` right on the target map.
 */

const updateSignatureBodySchema = z.object({
  mapConnectionId: z.string().regex(/^\d+$/).nullable().optional(),
  sigId: z.string().min(1).max(7).optional(),
  groupKey: z.enum(signatureGroupKey.enumValues).nullable().optional(),
  classKind: z.enum(signatureClassKind.enumValues).nullable().optional(),
  activityOverride: z.enum(signatureActivity.enumValues).nullable().optional(),
  typeId: z.number().int().positive().nullable().optional(),
  eolStage: z.enum(eolStage.enumValues).optional(),
  name: z.string().max(100).nullable().optional(),
  description: z.string().nullable().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const runtime = 'nodejs';

export const PATCH = withApiMetrics('/api/map/:mapId/signatures/:sigId', async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string; sigId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, sigId: rawSigId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const signatureId = parseBigInt(rawSigId);
  if (!signatureId) return Response.json({ ok: false, error: 'Invalid signature id.' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = updateSignatureBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  // Convert string ids and datetime strings to their native types for the helper.
  const patch: Parameters<typeof updateSignature>[0]['patch'] = {};
  if ('mapConnectionId' in parsed.data) {
    if (parsed.data.mapConnectionId == null) {
      patch.mapConnectionId = null;
    } else {
      const connId = parseBigInt(parsed.data.mapConnectionId);
      if (!connId) return Response.json({ ok: false, error: 'Invalid connection id.' }, { status: 400 });
      patch.mapConnectionId = connId;
    }
  }
  if ('sigId' in parsed.data) patch.sigId = parsed.data.sigId;
  if ('groupKey' in parsed.data) patch.groupKey = parsed.data.groupKey;
  if ('classKind' in parsed.data) patch.classKind = parsed.data.classKind;
  if ('activityOverride' in parsed.data) patch.activityOverride = parsed.data.activityOverride;
  if ('typeId' in parsed.data) patch.typeId = parsed.data.typeId;
  if ('eolStage' in parsed.data) patch.eolStage = parsed.data.eolStage;
  if ('name' in parsed.data) patch.name = parsed.data.name;
  if ('description' in parsed.data) patch.description = parsed.data.description;
  if ('expiresAt' in parsed.data && parsed.data.expiresAt !== undefined) {
    patch.expiresAt = new Date(parsed.data.expiresAt);
  }

  const result = await updateSignature({
    mapId: guard.mapId,
    signatureId,
    characterId: guard.characterId,
    patch,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});

export const DELETE = withApiMetrics('/api/map/:mapId/signatures/:sigId', async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string; sigId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, sigId: rawSigId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const signatureId = parseBigInt(rawSigId);
  if (!signatureId) return Response.json({ ok: false, error: 'Invalid signature id.' }, { status: 400 });

  const result = await deleteSignature({
    mapId: guard.mapId,
    signatureId,
    characterId: guard.characterId,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
