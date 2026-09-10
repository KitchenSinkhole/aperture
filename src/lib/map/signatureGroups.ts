import type { SignatureGroupKey } from '@/types';

/**
 * Scanner-level signature groups. The seven entries match EVE's in-game
 * probe-scanner "Group" column. `scannerNames` are the literal strings the
 * EVE client emits in the paste (used by the paste resolver to map each
 * row to a group key); a group may have several aliases, since EVE qualifies
 * some sites by the content that spawned them (Combat covers the plain site
 * plus the Factional Warfare, Homefront and Insurgency variants). `label` is
 * the human-readable label used in the UI — exactly one entry per group key,
 * so the catalog can drive group dropdowns/chips directly.
 *
 * This catalog has no DB dependency — `ap_map_signature.group_key` is a
 * `pgEnum` whose values are the seven keys below. The catalog can be
 * imported from server and client code alike.
 */
export type SignatureGroupOption = {
  key: SignatureGroupKey;
  label: string;
  scannerNames: readonly string[];
};

export const SIGNATURE_GROUP_CATALOG: readonly SignatureGroupOption[] = [
  {
    key: 'combat',
    label: 'Combat',
    scannerNames: [
      'Combat Site',
      'Factional Warfare Site - Combat Site',
      'Homefront Operation Site - Combat Site',
      'Insurgency Site - Combat Site',
    ],
  },
  { key: 'relic',    label: 'Relic',    scannerNames: ['Relic Site'] },
  { key: 'data',     label: 'Data',     scannerNames: ['Data Site'] },
  { key: 'gas',      label: 'Gas',      scannerNames: ['Gas Site'] },
  { key: 'wormhole', label: 'Wormhole', scannerNames: ['Wormhole'] },
  { key: 'ore',      label: 'Ore',      scannerNames: ['Ore Site'] },
  { key: 'ghost',    label: 'Ghost',    scannerNames: ['Ghost Site'] },
];

/**
 * Lookup table from the scanner's literal Group cell to the group key.
 * Case-insensitive exact match; `signatureGroupKeyFromScannerName` layers a
 * substring fallback on top.
 */
const scannerNameToKey = new Map<string, SignatureGroupKey>(
  SIGNATURE_GROUP_CATALOG.flatMap((g) =>
    g.scannerNames.map((name) => [name.toLowerCase(), g.key] as const),
  ),
);

/**
 * Resolve an EVE-emitted "Group" cell to a `SignatureGroupKey`, or `null`
 * if the cell doesn't match any known scanner group. Exact match first, then
 * a substring fallback, so both a qualifier EVE prepends
 * ("Insurgency Site - Combat Site") and a suffix it appends
 * ("Combat Site (Lookout)") classify without a catalog entry of their own.
 *
 * Only ever pass the Group cell. The fallback is deliberately loose and would
 * swallow real site names — "Unstable Wormhole" is a Drifter combat site, not
 * a wormhole. Use `isScannerGroupName` for the Name cell.
 */
export function signatureGroupKeyFromScannerName(
  scannerName: string | null | undefined,
): SignatureGroupKey | null {
  if (!scannerName) return null;
  const lower = scannerName.trim().toLowerCase();
  const direct = scannerNameToKey.get(lower);
  if (direct) return direct;
  for (const g of SIGNATURE_GROUP_CATALOG) {
    for (const name of g.scannerNames) {
      if (lower.includes(name.toLowerCase())) return g.key;
    }
  }
  return null;
}

/**
 * True when the cell is exactly one of the catalog's scanner Group labels,
 * case-insensitively. Matching is exact: EVE repeats the Group cell in the
 * Name cell at low scan strength, but real site names embed the same words
 * ("Rock Formation and Wormhole"), so a fuzzy test here erases them.
 */
export function isScannerGroupName(value: string | null | undefined): boolean {
  if (!value) return false;
  return scannerNameToKey.has(value.trim().toLowerCase());
}

/** Human-readable label for a `SignatureGroupKey`, or null when unknown. */
export function labelForSignatureGroupKey(
  key: SignatureGroupKey | null | undefined,
): string | null {
  if (!key) return null;
  const hit = SIGNATURE_GROUP_CATALOG.find((g) => g.key === key);
  return hit?.label ?? null;
}
