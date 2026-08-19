## signatureGroups.ts

**Purpose:** Static catalog of the seven scanner-level signature groups (Combat / Relic / Data / Gas / Wormhole / Ore / Ghost) plus helpers that map between EVE-scanner strings, the `signature_group_key` pgEnum, and UI labels.
**File:** `src/lib/map/signatureGroups.ts`

The catalog has no DB dependency: `ap_map_signature.group_key` is a `pgEnum` and the seven values are baked into the schema. Of the seven scanner groups only `Wormhole` exists as a `universe_group` row in the SDE; the cosmic six are scanner-only and not present in `universe_group`, which is why the model uses a key, not an FK.

Safe to import from both server-only and client modules — exports only static data plus pure helpers.

---

### `SIGNATURE_GROUP_CATALOG: readonly SignatureGroupOption[]`
Exactly one entry per group key, in the order shown in the UI dropdown — so the catalog can drive group dropdowns/chips directly without de-duping. Each entry carries:
- `key` — the `SignatureGroupKey` enum value (`'combat'`, `'relic'`, `'data'`, `'gas'`, `'wormhole'`, `'ore'`, `'ghost'`).
- `label` — UI label (e.g. `'Combat'`).
- `scannerNames` — the literal strings EVE emits in the Group column of the probe-scanner paste. A group may have several aliases: `combat` covers `'Combat Site'`, `'Factional Warfare Site - Combat Site'`, `'Homefront Operation Site - Combat Site'` and `'Insurgency Site - Combat Site'`.

---

### `signatureGroupKeyFromScannerName(scannerName: string | null | undefined): SignatureGroupKey | null`
Resolve a scanner-emitted Group cell to a `SignatureGroupKey`. Case-insensitive exact match first, then a substring fallback, so a qualifier EVE prepends (`'Insurgency Site - Combat Site'`) or a suffix it appends (`'Combat Site (Lookout)'`) classifies without its own catalog entry. Returns `null` when the cell is empty or doesn't match any known group.

Only for the Group cell: the substring fallback would swallow real site names, since the Drifter combat sites are named `'Unstable Wormhole'`, `'Caged Wormhole'` and the like.

Used by `signatureReader.resolveSignatureRows` to classify each pasted row.

---

### `isScannerGroupName(value: string | null | undefined): boolean`
True when the cell is exactly one of the catalog's `scannerNames`, case-insensitively (leading/trailing whitespace ignored). Matching is exact so site names that embed a group word survive.

Used by `signatureReader` to null out a Name cell in which EVE has repeated the Group string at low scan strength.

---

### `labelForSignatureGroupKey(key: SignatureGroupKey | null | undefined): string | null`
Human-readable label for a group key, or `null` when the key is null/unknown. Used by client components that render the group cell.

---

### Types
- `SignatureGroupOption` — `{ key, label, scannerNames }`.

Re-exported from `src/types/index.ts`.

### Depends on
- `SignatureGroupKey` from `@/types` (in turn from the `signature_group_key` `pgEnum`).
