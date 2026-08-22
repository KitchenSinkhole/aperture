import 'server-only';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { apCharacter, apSystemNote, universeSystem } from '@/db/schema';
import type { ApSystemNote, IntelScope } from '@/types';
import { noteVisibleTo, requireNoteIntelTenant, type IntelViewer } from './guard';

/** A global system-note row shaped for the sidebar (ids as strings, names resolved). */
export type SystemNote = {
  id: string;
  systemId: number;
  body: string;
  /** Organizational chip; null ⇒ uncategorized. */
  category: string | null;
  /** A locked note refuses edit/delete server-side until unlocked. */
  locked: boolean;
  /** `ap_character.name` of the author — light at-a-glance accountability. Null if erased. */
  createdByName: string | null;
  /** `ap_character.name` of the last editor. Null when never edited (or editor erased). */
  lastEditedByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Who may see this row. */
  scope: IntelScope;
  /**
   * The id of the entity `scope` names — character, corporation or alliance.
   * Null only for the erased-owner `private` row, which is admin-only.
   */
  scopeEntityId: number | null;
};

/** A search hit in the notes browser: a note plus its system's name. */
export type SystemNoteSearchResult = SystemNote & { systemName: string };

const editor = alias(apCharacter, 'editor');

const noteSelection = {
  id: apSystemNote.id,
  systemId: apSystemNote.systemId,
  body: apSystemNote.body,
  category: apSystemNote.category,
  locked: apSystemNote.locked,
  createdByName: apCharacter.name,
  lastEditedByName: editor.name,
  createdAt: apSystemNote.createdAt,
  updatedAt: apSystemNote.updatedAt,
  scope: apSystemNote.scope,
  scopeCharacterId: apSystemNote.scopeCharacterId,
  scopeCorporationId: apSystemNote.scopeCorporationId,
  scopeAllianceId: apSystemNote.scopeAllianceId,
};

type NoteRow = {
  id: bigint;
  systemId: number;
  body: string;
  category: string | null;
  locked: boolean;
  createdByName: string | null;
  lastEditedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  scope: IntelScope;
  scopeCharacterId: bigint | null;
  scopeCorporationId: bigint | null;
  scopeAllianceId: bigint | null;
};

/** The one populated `scope_*` id for a row's branch, as a number. */
function scopeEntityIdOf(row: {
  scope: IntelScope;
  scopeCharacterId: bigint | null;
  scopeCorporationId: bigint | null;
  scopeAllianceId: bigint | null;
}): number | null {
  const id =
    row.scope === 'private'
      ? row.scopeCharacterId
      : row.scope === 'corp'
        ? row.scopeCorporationId
        : row.scopeAllianceId;
  return id === null ? null : Number(id);
}

function shape(r: NoteRow): SystemNote {
  return {
    id: r.id.toString(),
    systemId: r.systemId,
    body: r.body,
    category: r.category,
    locked: r.locked,
    createdByName: r.createdByName,
    lastEditedByName: r.lastEditedByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    scope: r.scope,
    scopeEntityId: scopeEntityIdOf(r),
  };
}

/**
 * Global system notes for the given universe systems as seen on `mapId`, keyed
 * by `system_id`, newest first within each system, filtered to the rows
 * `viewerCharacterId`'s scope admits. One batched query joins `ap_character`
 * (twice — author and last editor) for names. Systems with no admitted notes
 * are absent from the record — which is also what keeps the map-node note pill
 * honest: a system carrying nothing but another org's notes shows no pill.
 *
 * Empty for a viewer `requireNoteIntelTenant` refuses — a guest on someone
 * else's map sees no notes there, including their own organisation's rows.
 *
 * Map and viewer are both required rather than optional so no caller can reach
 * the table unfiltered: `ap_system_note` rows carry no `map_id`, so these
 * filters are the only thing standing between a 256-system `system-data` sweep
 * and the deployment's whole note journal.
 *
 * NOTE: system notes have no realtime channel (they are system-scoped, not
 * map-scoped — see `ap_system_note`). This snapshot is load-time only: a note
 * another user adds appears here on the next page load, not live.
 */
export async function systemNotesForSystems(
  mapId: bigint,
  systemIds: number[],
  viewerCharacterId: bigint,
): Promise<Record<number, SystemNote[]>> {
  if (systemIds.length === 0) return {};
  const tenant = await requireNoteIntelTenant(mapId, viewerCharacterId);
  if (!tenant.ok) return {};

  const rows = await db
    .select(noteSelection)
    .from(apSystemNote)
    .leftJoin(apCharacter, eq(apSystemNote.createdByCharacterId, apCharacter.id))
    .leftJoin(editor, eq(apSystemNote.lastEditedByCharacterId, editor.id))
    .where(and(inArray(apSystemNote.systemId, systemIds), noteVisibleTo(tenant.viewer)))
    .orderBy(asc(apSystemNote.systemId), desc(apSystemNote.createdAt));

  const out: Record<number, SystemNote[]> = {};
  for (const r of rows) {
    (out[r.systemId] ??= []).push(shape(r));
  }
  return out;
}

/** Search-result cap: enough for a useful browse, small enough to stay snappy. */
export const NOTE_SEARCH_LIMIT = 50;

/**
 * Note search for the browser: case-insensitive substring match on the note
 * body, the system's name, OR the category key (so a chip name like `warning`
 * pulls up every note wearing it), newest first, capped at `NOTE_SEARCH_LIMIT`.
 * Joins `universe_system` for the display name.
 *
 * The viewer filter is applied in the WHERE clause, **before** the cap —
 * filtering a capped page afterwards would silently return short pages, and
 * the bug stays invisible until someone else's data is in the table. The
 * viewer is required so no caller can search the journal unfiltered.
 */
export async function searchSystemNotes(
  query: string,
  viewer: IntelViewer,
): Promise<SystemNoteSearchResult[]> {
  const q = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const rows = await db
    .select({ ...noteSelection, systemName: universeSystem.name })
    .from(apSystemNote)
    .innerJoin(universeSystem, eq(apSystemNote.systemId, universeSystem.id))
    .leftJoin(apCharacter, eq(apSystemNote.createdByCharacterId, apCharacter.id))
    .leftJoin(editor, eq(apSystemNote.lastEditedByCharacterId, editor.id))
    .where(
      and(
        or(
          ilike(apSystemNote.body, q),
          ilike(universeSystem.name, q),
          ilike(apSystemNote.category, q),
        ),
        noteVisibleTo(viewer),
      ),
    )
    .orderBy(desc(apSystemNote.createdAt))
    .limit(NOTE_SEARCH_LIMIT);
  return rows.map((r) => ({ ...shape(r), systemName: r.systemName }));
}

/**
 * Shape a freshly written `ap_system_note` row into a `SystemNote` for the
 * client, resolving author and last-editor names. Used by the create/update
 * routes so the client always receives a complete row to splice into local state.
 */
export async function withAuthorName(row: ApSystemNote): Promise<SystemNote> {
  async function nameOf(characterId: bigint | null): Promise<string | null> {
    if (characterId === null) return null;
    const [charRow] = await db
      .select({ name: apCharacter.name })
      .from(apCharacter)
      .where(eq(apCharacter.id, characterId));
    return charRow?.name ?? null;
  }
  return {
    id: row.id.toString(),
    systemId: row.systemId,
    body: row.body,
    category: row.category,
    locked: row.locked,
    createdByName: await nameOf(row.createdByCharacterId),
    lastEditedByName: await nameOf(row.lastEditedByCharacterId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    scope: row.scope,
    scopeEntityId: scopeEntityIdOf(row),
  };
}
