import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { createNote } from '@/lib/map/mutations/notes';
import { mapNoteSeverity } from '@/db/schema/ap/enums';
import { requireMapMutate } from '../../utils';
import { apertureConfig } from '../../../../../../aperture.config';

/**
 * POST /api/map/[mapId]/notes
 * Create a free-standing note on a map. Body:
 * { title, content?, severity?, positionX, positionY }.
 * Returns { ok, data: note.created payload, eventId }.
 *
 * Access: `map_update` right on the target map (same right as renaming a system).
 */

const createNoteBodySchema = z.object({
  title: z.string().min(1).max(apertureConfig.MAP_NOTE_TITLE_MAX_LENGTH),
  content: z.string().max(apertureConfig.MAP_NOTE_CONTENT_MAX_LENGTH).nullable().optional(),
  severity: z.enum(mapNoteSeverity.enumValues).optional(),
  positionX: z.number(),
  positionY: z.number(),
});

export const runtime = 'nodejs';

export async function POST(
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

  const parsed = createNoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const result = await createNote({
    mapId: guard.mapId,
    characterId: guard.characterId,
    title: parsed.data.title,
    content: parsed.data.content ?? null,
    severity: parsed.data.severity ?? 'neutral',
    positionX: parsed.data.positionX,
    positionY: parsed.data.positionY,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
