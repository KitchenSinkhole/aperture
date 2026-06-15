## signatureGroups.ts

**Purpose:** Static catalog of the seven scanner-level signature groups (Combat / Relic / Data / Gas / Wormhole / Ore / Ghost) plus helpers that map between EVE-scanner strings, the `signature_group_key` pgEnum, and UI labels.
**File:** `src/lib/map/signatureGroups.ts`

The catalog has no DB dependency: `ap_map_signature.group_key` is a `pgEnum` and the seven values are baked into the schema. Of the seven scanner groups only `Wormhole` exists as a `universe_group` row in the SDE; the cosmic six are scanner-only and not present in `universe_group`, which is why the model uses a key, not an FK.

Safe to import from both server-only and client modules — exports only static data plus pure helpers.

---

### `SIGNATURE_GROUP_CATALOG: readonly SignatureGroupOption[]`
Eight entries in the order shown in the UI dropdown. Each entry carries:
- `key` — the `SignatureGroupKey` enum value (`'combat'`, `'relic'`, `'data'`, `'gas'`, `'wormhole'`, `'ore'`, `'ghost'`).
- `label` — UI label (e.g. `'Combat'`).
- `scannerName` — literal string EVE emits in the Group column of the probe-scanner paste (e.g. `'Combat Site'`).

---

### `signatureGroupKeyFromScannerName(scannerName: string | null | undefined): SignatureGroupKey | null`
Resolve a scanner-emitted Group cell to a `SignatureGroupKey`. Case-insensitive direct match first; falls back to a startsWith match so an unexpected suffix doesn't silently null out the group. Returns `null` when the cell is empty or doesn't match any known group.

Used by `signatureReader.resolveSignatureRows` to classify each pasted row.

---

### `labelForSignatureGroupKey(key: SignatureGroupKey | null | undefined): string | null`
Human-readable label for a group key, or `null` when the key is null/unknown. Used by client components that render the group cell.

---

### Types
- `SignatureGroupOption` — `{ key, label, scannerName }`.

Re-exported from `src/types/index.ts`.

### Depends on
- `SignatureGroupKey` from `@/types` (in turn from the `signature_group_key` `pgEnum`).
