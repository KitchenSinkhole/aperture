## resolve/route.ts

**Purpose:** Best-effort preview resolver for the signature-paste dialog. Returns `(groupId, typeId)` for parsed rows so the dialog can show what'll happen on submit.
**File:** `src/app/api/map/[mapId]/signatures/resolve/route.ts`

---

### POST /api/map/[mapId]/signatures/resolve
**Body:** `{ rows: ParsedSigRow[] }` — capped at 500 entries. Each row carries `classKind` (`signature`/`anomaly`), which passes through to the `ResolvedSigRow` output unchanged.

**Auth & guards:** `requireMapView(rawMapId, session)` — view-only; 401 / 404. The bulk POST enforces the actual `map_update` right.

**Returns:** `{ ok: true, data: ResolvedSigRow[] }`. Preview-only — the bulk POST resolves again authoritatively before committing, so a stale preview cannot desync the final state.

**Why POST:** A typical 30-sig paste exceeds practical URL lengths; POST also matches the existing mutation-route style.
