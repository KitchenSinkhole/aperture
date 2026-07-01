## sigSearch.ts

**Purpose:** Pure client-side filter + sort over map signatures for the `sigSearch` panel (`SignatureSearchModule`).
**File:** `src/lib/map/sigSearch.ts`

---

### buildSigSearchResults(signatures, systems, filters, sortField, sortDir, now): SigSearchRow[]
Filters `signatures` by name (partial, case-insensitive, against `sig.name`), `groupKey`, max age in hours (against `sig.createdAt`), security class (against `system.security`), and class kind via the `includeAnomalies` / `includeSignatures` toggles (against `sig.classKind`). A sig with `classKind === null` (unknown class) matches neither toggle and always passes them. Joins each surviving sig to its parent `MapSystemNode`; sigs with no matching system are dropped. Sorts by `sigId` / `systemName` / `age` in the requested direction. `now` is a Unix-epoch ms value.

**Returns:** `SigSearchRow[]` — `{ sig, system, ageMs }` ordered per `sortField`/`sortDir`.

---

### Types
- `SigSearchRow` — `{ sig: MapSignature; system: MapSystemNode; ageMs: number }`
- `SigSortField` — `'sigId' | 'systemName' | 'age'`
- `SigSortDir` — `'asc' | 'desc'`
