## route.ts (POST /api/system-notes)

**Purpose:** Create a global system-note row.
**File:** `src/app/api/system-notes/route.ts`

---

### POST /api/system-notes
Auth: `requireMapView(mapId, session)` then `requireNoteIntelTenant` — the caller must view the body's `mapId` *and* belong to the entity that owns it (a guest with a role grant gets 403); the row's `scope` triple derives from that map. Body (Zod): `mapId` digit string, `systemId` int>0, `body` 1–2000, `category` nullable optional (validated at request time against the `ap_instance.system_note_categories` vocabulary — a runtime read, so an admin's edit applies without a deploy), `locked` boolean optional. Calls `createSystemNote({ ...body, characterId, scope })` (which also writes a `create` audit event), then `withAuthorName(row)`.

**Responses:** `200 { ok: true, data: SystemNote }`; `400` invalid JSON / body / unknown category / FK violation (unknown system); `401` not signed in; `403` tenancy refusal; `404` non-viewable map (or unowned/soft-deleted map).

**Not a map event:** a note row carries no `map_id` (the body's `mapId` is only the scope selector) so this emits no `ap_map_event` / realtime update.
