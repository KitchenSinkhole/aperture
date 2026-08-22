import 'server-only';
import { eq, type InferInsertModel } from 'drizzle-orm';
import { db } from '@/db/client';
import { apSystemNote, apSystemNoteEvent } from '@/db/schema';
import type { ApSystemNote } from '@/types';
import type { IntelScopeOwner } from './guard';

/**
 * Global system-note mutations. Notes are manual intel with no `map_id`, so
 * they do NOT go through `commitMapEvent` / `ap_map_event` and emit no realtime
 * event — they are a plain REST resource.
 *
 * Every mutation writes the `ap_system_note` row AND one `ap_system_note_event`
 * audit row in the same transaction, stamped with the acting character, so that
 * — since a note is editable by anyone its scope admits, not only its creator —
 * griefers remain identifiable. The audit row also carries the row's tenancy
 * denormalized, since a `delete` event outlives the row it describes. Deletes
 * are hard deletes; the audit row carries the full pre-delete snapshot so the
 * intel stays recoverable.
 *
 * Locking: a locked note rejects every change except the unlock itself
 * (`{ locked: false }` alone), and rejects delete. Anyone the row's scope
 * admits may toggle the lock — it is a guard rail against accidents, not an
 * ownership claim; the audit log covers malice. Scope is enforced by the route
 * guard before these run, so a locked row outside the caller's scope 404s
 * rather than 409ing.
 */

export type CreateSystemNoteInput = {
  systemId: number;
  body: string;
  category?: string | null;
  locked?: boolean;
  /** Who may see the row, derived by the caller from the map it was written on. */
  scope: IntelScopeOwner;
  characterId: bigint | null;
};

export type UpdateSystemNotePatch = {
  body?: string;
  category?: string | null;
  locked?: boolean;
};

export type UpdateSystemNoteInput = {
  noteId: bigint;
  patch: UpdateSystemNotePatch;
  characterId: bigint | null;
};

export type DeleteSystemNoteInput = {
  noteId: bigint;
  characterId: bigint | null;
};

/** Thrown when a mutation is rejected because the note is locked. */
export class SystemNoteLockedError extends Error {
  constructor() {
    super('Note is locked.');
    this.name = 'SystemNoteLockedError';
  }
}

/**
 * The row's tenancy, for denormalizing onto its `ap_system_note_event` row. The
 * event table holds the full pre-delete snapshot, so it has to carry the scope
 * itself — on a delete the parent row it would otherwise be read from is gone.
 */
function scopeOf(row: ApSystemNote): IntelScopeOwner {
  return {
    scope: row.scope,
    scopeCharacterId: row.scopeCharacterId,
    scopeCorporationId: row.scopeCorporationId,
    scopeAllianceId: row.scopeAllianceId,
  };
}

/** Plain JSON snapshot of a note row for the audit `payload` (no bigints/Dates). */
function snapshot(row: ApSystemNote) {
  return {
    id: row.id.toString(),
    systemId: row.systemId,
    body: row.body,
    category: row.category,
    locked: row.locked,
    createdByCharacterId: row.createdByCharacterId?.toString() ?? null,
    lastEditedByCharacterId: row.lastEditedByCharacterId?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Insert a note + a `create` audit event. Returns the new row. */
export function createSystemNote(input: CreateSystemNoteInput): Promise<ApSystemNote> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apSystemNote)
      .values({
        systemId: input.systemId,
        body: input.body,
        category: input.category ?? null,
        locked: input.locked ?? false,
        ...input.scope,
        createdByCharacterId: input.characterId,
      })
      .returning();
    await tx.insert(apSystemNoteEvent).values({
      noteId: row!.id,
      systemId: row!.systemId,
      characterId: input.characterId,
      kind: 'create',
      payload: snapshot(row!),
      ...scopeOf(row!),
    });
    return row!;
  });
}

/**
 * Patch a note (only present keys change) + an `update` audit event carrying
 * the patch AND the full pre-edit snapshot — without it, an edit would destroy
 * the original text unrecoverably while a delete stays recoverable, inverting
 * the incentive the lock/audit design creates. Returns the updated row, or
 * null if the id does not exist (no event written).
 *
 * Locking: a locked note admits only the bare unlock; anything else throws
 * `SystemNoteLockedError`. A lock-only patch that matches the current state is
 * an idempotent no-op (current row returned, no event) — a double-click must
 * not 409. `updated_at` and the last-editor stamp bump only when the patch
 * touches content (`body` / `category`); a pure lock toggle is not an edit and
 * must not claim edit attribution.
 */
export function updateSystemNote(input: UpdateSystemNoteInput): Promise<ApSystemNote | null> {
  const { patch } = input;
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(apSystemNote)
      .where(eq(apSystemNote.id, input.noteId))
      .for('update');
    if (!existing) return null;

    const touchesContent = 'body' in patch || 'category' in patch;
    const lockOnly = 'locked' in patch && !touchesContent;
    if (lockOnly && patch.locked === existing.locked) return existing;
    const isBareUnlock = lockOnly && patch.locked === false;
    if (existing.locked && !isBareUnlock) throw new SystemNoteLockedError();

    const set: Partial<InferInsertModel<typeof apSystemNote>> = {};
    if (touchesContent) {
      set.updatedAt = new Date();
      set.lastEditedByCharacterId = input.characterId;
    }
    if ('body' in patch) set.body = patch.body;
    if ('category' in patch) set.category = patch.category ?? null;
    if ('locked' in patch) set.locked = patch.locked;

    const [row] = await tx
      .update(apSystemNote)
      .set(set)
      .where(eq(apSystemNote.id, input.noteId))
      .returning();
    if (!row) return null;

    await tx.insert(apSystemNoteEvent).values({
      noteId: row.id,
      systemId: row.systemId,
      characterId: input.characterId,
      kind: 'update',
      payload: { patch, previous: snapshot(existing) },
      ...scopeOf(row),
    });
    return row;
  });
}

/**
 * Hard-delete a note + a `delete` audit event holding the full pre-delete
 * snapshot. Returns the deleted row, or null if the id did not exist. Throws
 * `SystemNoteLockedError` when the note is locked.
 */
export function deleteSystemNote(input: DeleteSystemNoteInput): Promise<ApSystemNote | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ locked: apSystemNote.locked })
      .from(apSystemNote)
      .where(eq(apSystemNote.id, input.noteId))
      .for('update');
    if (!existing) return null;
    if (existing.locked) throw new SystemNoteLockedError();

    const [row] = await tx
      .delete(apSystemNote)
      .where(eq(apSystemNote.id, input.noteId))
      .returning();
    if (!row) return null;

    await tx.insert(apSystemNoteEvent).values({
      noteId: row.id,
      systemId: row.systemId,
      characterId: input.characterId,
      kind: 'delete',
      payload: snapshot(row),
      ...scopeOf(row),
    });
    return row;
  });
}
