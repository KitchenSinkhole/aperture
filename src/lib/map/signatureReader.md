## signatureReader.ts

**Purpose:** Server-only resolver that classifies parsed probe-scanner rows: maps the EVE-emitted "Group" cell to a `SignatureGroupKey` (via the static catalog in `signatureGroups.ts`) and, for wormhole-group rows only, resolves the "Name" cell against `universe_wormhole.name` to obtain `typeId`. The pure parser lives next door in `signatureParser.ts` so it can be imported from client components without pulling the DB client into the bundle.
**File:** `src/lib/map/signatureReader.ts`

---

### resolveSignatureRows(rows: ParsedSigRow[]): Promise<ResolvedSigRow[]>
Single round-trip to `universe_wormhole` (filtered by the unique WH names that appeared in wormhole-group rows), zero queries for the six cosmic groups. Returns each input row enriched with `{ groupKey, typeId }` and a possibly-nulled `name`. The parser-supplied `classKind` (`signature`/`anomaly`) passes through untouched:

- `groupKey` is derived from `groupName` via `signatureGroupKeyFromScannerName` — pure, no DB hit.
- `typeId` is set only when `groupKey === 'wormhole'` and `name` matches a `universe_wormhole.name`. Otherwise null.
- `name` is nulled out when the cell is empty, equals the Group cell verbatim, or is itself one of the scanner-level Group labels (handles EVE's low-scan-strength behaviour of repeating the Group string in the Name column).

Partial scans still flow through — unresolvable fields stay `null`.

---

### Types
- `ResolvedSigRow = ParsedSigRow & { groupKey: SignatureGroupKey | null; typeId: number | null }`
- `ParsedSigRow` is re-exported from `./signatureParser` (defined there).

Both re-exported from `src/types/index.ts`.

### Why no `universe_type` lookup for cosmic sigs
EVE cosmic-site names (Combat / Relic / Data / Gas / Ore / Ghost) are not present in `universe_type`. The plan's prior `(groupId, name) → typeId` lookup against `universe_type` always returned null for those groups. The new model stores the site name verbatim in `ap_map_signature.name` and treats `typeId` as wormhole-only.

### Depends on
- `db` / `universeWormhole` from `@/db/*`
- `signatureGroupKeyFromScannerName` from `./signatureGroups`
- `SignatureGroupKey` from `@/types`
