import 'server-only';
import { and, eq, type InferInsertModel } from 'drizzle-orm';
import { apCharacter, apMapNote, mapNoteSeverity } from '@/db/schema';
import { commitMapEvent, type ActionResult, type Tx } from './core';
import type { MapEventPatch, MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Note-level map mutations. Each is exactly one `commitMapEvent` call (one
 * `ap_map_event` row → one realtime broadcast), mirroring `systems.ts`. Unlike
 * systems, notes are hard-deleted (a note has no natural re-add key) and carry
 * denormalized attribution: `mutate` resolves the acting character's name from
 * `ap_character` and embeds it in the payload so the inspector can render
 * "created by X · last edited by Y" without a follow-up roster lookup.
 */

type NoteSeverity = (typeof mapNoteSeverity.enumValues)[number];

export type CreateNoteInput = {
  mapId: bigint;
  characterId: bigint | null;
  title: string;
  content: string | null;
  severity: NoteSeverity;
  positionX: number;
  positionY: number;
};

/** Fields a client may change on a note. Omitted keys are left untouched. */
export type UpdateNotePatch = {
  title?: string;
  content?: string | null;
  severity?: NoteSeverity;
  locked?: boolean;
  positionX?: number;
  positionY?: number;
};

export type UpdateNoteInput = {
  mapId: bigint;
  /** `ap_map_note.id` (the xyflow node id). */
  noteId: bigint;
  characterId: bigint | null;
  patch: UpdateNotePatch;
};

export type DeleteNoteInput = {
  mapId: bigint;
  noteId: bigint;
  characterId: bigint | null;
};

/** Resolve an acting character's name for the denormalized attribution payload. */
async function resolveCharacterName(tx: Tx, characterId: bigint | null): Promise<string | null> {
  if (characterId === null) return null;
  const [row] = await tx
    .select({ name: apCharacter.name })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));
  return row?.name ?? null;
}

/**
 * Create a free-standing note on a map. Inserts the row, sets both attribution
 * columns to the actor, and emits `note.created` carrying the full node body the
 * canvas needs to render it (incl. resolved creator/last-editor names).
 */
export function createNote(input: CreateNoteInput): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'note.created',
    mutate: async (tx) => {
      const now = new Date();
      const [note] = await tx
        .insert(apMapNote)
        .values({
          mapId: input.mapId,
          title: input.title,
          content: input.content,
          severity: input.severity,
          positionX: input.positionX,
          positionY: input.positionY,
          createdByCharacterId: input.characterId,
          lastEditedByCharacterId: input.characterId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = note!;
      const actorName = await resolveCharacterName(tx, input.characterId);

      return {
        id: row.id.toString(),
        title: row.title,
        content: row.content,
        severity: row.severity,
        locked: row.locked,
        positionX: row.positionX,
        positionY: row.positionY,
        createdByCharacterId: row.createdByCharacterId === null ? null : Number(row.createdByCharacterId),
        createdByName: actorName,
        lastEditedByCharacterId:
          row.lastEditedByCharacterId === null ? null : Number(row.lastEditedByCharacterId),
        lastEditedByName: actorName,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      } satisfies MapEventPatch<'note.created'>;
    },
  });
}

/**
 * Update a note's fields. Only the keys present in `patch` change; every update
 * stamps `last_edited_by` + `updated_at` (so a drag also refreshes the editor
 * attribution). Emits `note.updated` — `title` always rides as the audit
 * descriptor, the changed fields ride conditionally.
 */
export function updateNote(input: UpdateNoteInput): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'note.updated',
    mutate: async (tx) => {
      const { patch } = input;
      const set: Partial<InferInsertModel<typeof apMapNote>> = {
        updatedAt: new Date(),
        lastEditedByCharacterId: input.characterId,
      };
      if ('title' in patch) set.title = patch.title;
      if ('content' in patch) set.content = patch.content;
      if ('severity' in patch) set.severity = patch.severity;
      if ('locked' in patch) set.locked = patch.locked;
      if ('positionX' in patch) set.positionX = patch.positionX;
      if ('positionY' in patch) set.positionY = patch.positionY;

      const [note] = await tx
        .update(apMapNote)
        .set(set)
        .where(and(eq(apMapNote.id, input.noteId), eq(apMapNote.mapId, input.mapId)))
        .returning();
      if (!note) throw new Error('Note not found on map.');
      const actorName = await resolveCharacterName(tx, input.characterId);

      const out: MapEventPatch<'note.updated'> = {
        id: note.id.toString(),
        title: note.title,
        lastEditedByCharacterId:
          note.lastEditedByCharacterId === null ? null : Number(note.lastEditedByCharacterId),
        lastEditedByName: actorName,
        updatedAt: note.updatedAt.toISOString(),
      };
      if ('content' in patch) out.content = patch.content;
      if ('severity' in patch) out.severity = patch.severity;
      if ('locked' in patch) out.locked = patch.locked;
      if ('positionX' in patch) out.positionX = patch.positionX;
      if ('positionY' in patch) out.positionY = patch.positionY;
      return out;
    },
  });
}

/** Hard-delete a note. Emits `note.deleted` carrying the title for the audit trail. */
export function deleteNote(input: DeleteNoteInput): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'note.deleted',
    mutate: async (tx) => {
      const [note] = await tx
        .delete(apMapNote)
        .where(and(eq(apMapNote.id, input.noteId), eq(apMapNote.mapId, input.mapId)))
        .returning({ id: apMapNote.id, title: apMapNote.title });
      if (!note) throw new Error('Note not found on map.');
      return { id: note.id.toString(), title: note.title };
    },
  });
}
