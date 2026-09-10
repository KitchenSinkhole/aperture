## route.ts (PATCH / DELETE /api/structures/[structureId])

**Purpose:** Edit or remove a manual structure-intel row.
**File:** `src/app/api/structures/[structureId]/route.ts`

---

Both verbs parse `structureId` via `parseBigInt` (400 on bad id) and then run `requireStructureMutate(session, structureId)`, which loads the row and admits only a caller its `scope` admits. A row that is missing **or** outside the caller's scope answers the same `404`, so a `bigserial` id cannot be walked for existence.

### PATCH /api/structures/[structureId]
Body (Zod, all optional): `name` 1–100, `structureTypeId` int>0, `ownerCorporationId` int>0 nullable, `ownerName` ≤100 nullable, `notes` ≤2000 nullable. Calls `updateStructure` (writes an `update` audit event) → `withTypeName`. The patch cannot touch the `scope` triple; it can freely change `ownerCorporationId`, which is the citadel's in-game owner and carries no visibility meaning.
**Responses:** `200 { ok: true, data: StructureIntel }`; `404` unknown id or out of scope; `400` invalid id/JSON/body/FK; `401` not signed in.

### DELETE /api/structures/[structureId]
Calls `deleteStructure` (hard delete + `delete` audit event with full snapshot).
**Responses:** `200 { ok: true, data: { id } }`; `404` unknown id or out of scope; `400` invalid id; `401` not signed in.

**Not a map event:** the row carries no `map_id`; no `ap_map_event` / realtime update.
