## read.ts

**Purpose:** Read-side queries shaping global system notes for the sidebar and the notes browser.
**File:** `src/lib/system-notes/read.ts`

---

### systemNotesForSystems(mapId: bigint, systemIds: number[], viewerCharacterId: bigint): Promise<Record<number, SystemNote[]>>
Global system notes for the given universe systems as seen on `mapId`, keyed by `system_id`, newest first within each system, filtered to the rows the viewer's scope admits (`noteVisibleTo`). One batched query joins `ap_character` twice (author and last editor) for names. Systems with no admitted notes are absent from the record — which also keeps the map-node note pill honest: a system carrying nothing but another org's notes shows no pill. Empty for a viewer `requireNoteIntelTenant` refuses (a guest on someone else's map). Map and viewer are required, not optional, so no caller can reach the table unfiltered.

System notes have no realtime channel (system-scoped, not map-scoped): this snapshot is load-time only — a note another user adds appears on the next page load.

**Returns:** `SystemNote[]` per system id: `{ id (string), systemId, body, category, locked, createdByName, lastEditedByName, createdAt, updatedAt, scope, scopeEntityId }`.

---

### searchSystemNotes(query: string, viewer: IntelViewer): Promise<SystemNoteSearchResult[]>
Note search for the browser: case-insensitive substring match (ILIKE, with `%`/`_`/`\` escaped) on the note body, the system's name, OR the category key (a chip name like `warning` pulls up every note wearing it), newest first, capped at `NOTE_SEARCH_LIMIT`. Joins `universe_system` for the display name. The viewer filter is applied in the WHERE clause, **before** the cap — filtering a capped page afterwards would silently return short pages. The viewer is required so no caller can search the journal unfiltered.

**Returns:** `SystemNoteSearchResult[]` — a `SystemNote` plus `systemName`.

### NOTE_SEARCH_LIMIT: number
Search-result cap (50).

---

### withAuthorName(row: ApSystemNote): Promise<SystemNote>
Shapes a freshly written `ap_system_note` row into a `SystemNote` for the client, resolving author and last-editor names. Used by the create/update routes so the client always receives a complete row to splice into local state.
