import type { SignatureGroupKey } from '@/types';

/**
 * Scanner-level signature groups. The nine entries match EVE's in-game
 * probe-scanner "Group" column. `scannerNames` are the literal strings the
 * EVE client emits in the paste (used by the paste resolver to map each
 * row to a group key); a group may have several aliases (e.g. Combat covers
 * plain, Factional Warfare, and Homefront sites). `label` is the
 * human-readable label used in the UI — exactly one entry per group key, so
 * the catalog can drive group dropdowns/chips directly.
 *
 * This catalog has no DB dependency — `ap_map_signature.group_key` is a
 * `pgEnum` whose values are the nine keys below. The catalog can be
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
 * Case-insensitive match; falls back to a contains-style match so an
 * unexpected suffix ("Combat Site (XYZ)") still classifies.
 */
const scannerNameToKey = new Map<string, SignatureGroupKey>(
  SIGNATURE_GROUP_CATALOG.flatMap((g) =>
    g.scannerNames.map((name) => [name.toLowerCase(), g.key] as const),
  ),
);

/**
 * Resolve an EVE-emitted "Group" cell to a `SignatureGroupKey`, or `null`
 * if the cell doesn't match any known scanner group.
 */
export function signatureGroupKeyFromScannerName(
  scannerName: string | null | undefined,
): SignatureGroupKey | null {
  if (!scannerName) return null;
  const lower = scannerName.toLowerCase();
  const direct = scannerNameToKey.get(lower);
  if (direct) return direct;
  for (const g of SIGNATURE_GROUP_CATALOG) {
    for (const name of g.scannerNames) {
      if (lower.startsWith(name.toLowerCase())) return g.key;
    }
  }
  return null;
}

/** Human-readable label for a `SignatureGroupKey`, or null when unknown. */
export function labelForSignatureGroupKey(
  key: SignatureGroupKey | null | undefined,
): string | null {
  if (!key) return null;
  const hit = SIGNATURE_GROUP_CATALOG.find((g) => g.key === key);
  return hit?.label ?? null;
}
