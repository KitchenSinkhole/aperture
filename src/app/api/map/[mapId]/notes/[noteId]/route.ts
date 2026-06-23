import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { deleteNote, updateNote } from '@/lib/map/mutations/notes';
import { mapNoteSeverity } from '@/db/schema/ap/enums';
import { parseBigInt, requireMapMutate } from '../../../utils';
import { apertureConfig } from '../../../../../../../aperture.config';

/**
 * PATCH /api/map/[mapId]/notes/[noteId]  — update a note's fields.
 * DELETE /api/map/[mapId]/notes/[noteId] — hard-delete a note.
 *
 * [noteId] is `ap_map_note.id` (the xyflow node id).
 *
 * Access: `map_update` right on the target map.
 */

const updateNoteBodySchema = z.object({
  title: z.string().min(1).max(apertureConfig.MAP_NOTE_TITLE_MAX_LENGTH).optional(),
  content: z.string().max(apertureConfig.MAP_NOTE_CONTENT_MAX_LENGTH).nullable().optional(),
  severity: z.enum(mapNoteSeverity.enumValues).optional(),
  locked: z.boolean().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string; noteId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, noteId: rawNoteId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const noteId = parseBigInt(rawNoteId);
  if (!noteId) return Response.json({ ok: false, error: 'Invalid note id.' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = updateNoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const result = await updateNote({
    mapId: guard.mapId,
    noteId,
    characterId: guard.characterId,
    patch: parsed.data,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string; noteId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, noteId: rawNoteId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const noteId = parseBigInt(rawNoteId);
  if (!noteId) return Response.json({ ok: false, error: 'Invalid note id.' }, { status: 400 });

  const result = await deleteNote({
    mapId: guard.mapId,
    noteId,
    characterId: guard.characterId,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
