## signatureParser.ts

**Purpose:** Pure, client-safe parser for EVE probe-scanner clipboard text. Split from `signatureReader.ts` so the parse step can run in the paste dialog (a `'use client'` component) without dragging the DB-bound resolver — which is `server-only` — into the client bundle.
**File:** `src/lib/map/signatureParser.ts`

---

### parseSignaturePaste(text: string): ParsedSigRow[]
Pure splitter — no DB, no `Date.now()`. The EVE probe scanner emits 6 tab-separated columns in fixed order: `ID, Class, Group, Name, Signal, Distance` (see `docs/reference/signature-scan-results.md`). A row is accepted only when cell 0 is a valid `AAA-NNN` sig id (the language-independent gate, which also drops the header row) **and** cell 1 resolves to a recognized localized Class kind via `signatureClassKind` (`./signatureClasses`). The Class check primarily discards other in-game signature classes (ships, deployables, drones, …) that are valid scanner entries but don't belong on a map, and incidentally rejects unrelated pasted text. Falls back to multi-space splitting for clipboards that strip tabs (best-effort — blank columns can't be recovered without tabs). Distance is used/validated but discarded; the resolved Class kind (`signature`/`anomaly`) is carried as `classKind`, alongside `sigId`, `name`, `groupName`, `signal`.

**Parameters:**
- `text` — raw clipboard string.

**Returns:** `ParsedSigRow[]`.

---

### Types
- `ParsedSigRow = { sigId, name | null, groupName | null, signal | null, classKind: SignatureClassKind }`

Re-exported from `src/types/index.ts`.

### Depends on
- `signatureClassKind` (`./signatureClasses`) — localized Class-cell → `signature`/`anomaly` (also the row filter; `null` drops the row).

### Why no WH-type code resolution
The probe scanner *never* emits the wormhole type code (`A239`, `K162`, …) in the paste — that's only knowable after warping in and opening "Show Info" on the WH. The existing `WormholeTypeSelect` dropdown in `SignatureModule` stays the user-driven entry point for the code.
