import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { requireStructureMutate } from '@/lib/structures/guard';
import { deleteStructure, updateStructure } from '@/lib/structures/mutations';
import { withTypeName } from '@/lib/structures/read';
import { parseBigInt } from '../../map/utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * PATCH / DELETE /api/structures/[structureId] — edit or remove a manual
 * structure-intel row. Any authenticated user may write; the mutation records an
 * `update` / `delete` row in `ap_structure_event` for accountability.
 */

export const runtime = 'nodejs';

const updateStructureBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  structureTypeId: z.number().int().positive().optional(),
  ownerCorporationId: z.number().int().positive().nullable().optional(),
  ownerName: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const PATCH = withApiMetrics('/api/structures/:structureId', async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ structureId: string }> },
) {
  const session = await getSession();
  const guard = requireStructureMutate(session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const { structureId: rawId } = await params;
  const structureId = parseBigInt(rawId);
  if (!structureId) {
    return Response.json({ ok: false, error: 'Invalid structure id.' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = updateStructureBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  try {
    const row = await updateStructure({
      structureId,
      patch: parsed.data,
      characterId: guard.characterId,
    });
    if (!row) return Response.json({ ok: false, error: 'Structure not found.' }, { status: 404 });
    const data = await withTypeName(row);
    return Response.json({ ok: true, data });
  } catch {
    return Response.json(
      { ok: false, error: 'Could not update structure — unknown structure type.' },
      { status: 400 },
    );
  }
});

export const DELETE = withApiMetrics('/api/structures/:structureId', async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ structureId: string }> },
) {
  const session = await getSession();
  const guard = requireStructureMutate(session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const { structureId: rawId } = await params;
  const structureId = parseBigInt(rawId);
  if (!structureId) {
    return Response.json({ ok: false, error: 'Invalid structure id.' }, { status: 400 });
  }

  const row = await deleteStructure({ structureId, characterId: guard.characterId });
  if (!row) return Response.json({ ok: false, error: 'Structure not found.' }, { status: 404 });
  return Response.json({ ok: true, data: { id: row.id.toString() } });
});
