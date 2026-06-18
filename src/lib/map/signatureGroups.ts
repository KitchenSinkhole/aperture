import type { SignatureGroupKey } from '@/types';

/**
 * Scanner-level signature groups. The seven entries match EVE's in-game
 * probe-scanner "Group" column. `scannerName` is the literal string the
 * EVE client emits in the paste (used by the paste resolver to map each
 * row to a group key); `label` is the human-readable label used in the UI.
 *
 * This catalog has no DB dependency — `ap_map_signature.group_key` is a
 * `pgEnum` whose values are the seven keys below. The catalog can be
 * imported from server and client code alike.
 */
export type SignatureGroupOption = {
  key: SignatureGroupKey;
  label: string;
  scannerName: string;
};

export const SIGNATURE_GROUP_CATALOG: readonly SignatureGroupOption[] = [
  { key: 'combat',   label: 'Combat',   scannerName: 'Combat Site' },
  { key: 'combat',   label: 'Combat',   scannerName: 'Factional Warfare Site - Combat Site'},
  { key: 'combat',   label: 'Combat',   scannerName: 'Homefront Operation Site - Combat Site'},
  { key: 'relic',    label: 'Relic',    scannerName: 'Relic Site' },
  { key: 'data',     label: 'Data',     scannerName: 'Data Site' },
  { key: 'gas',      label: 'Gas',      scannerName: 'Gas Site' },
  { key: 'wormhole', label: 'Wormhole', scannerName: 'Wormhole' },
  { key: 'ore',      label: 'Ore',      scannerName: 'Ore Site' },
  { key: 'ghost',    label: 'Ghost',    scannerName: 'Ghost Site' },
];

/**
 * Lookup table from the scanner's literal Group cell to the group key.
 * Case-insensitive match; falls back to a contains-style match so an
 * unexpected suffix ("Combat Site (XYZ)") still classifies.
 */
const scannerNameToKey = new Map<string, SignatureGroupKey>(
  SIGNATURE_GROUP_CATALOG.map((g) => [g.scannerName.toLowerCase(), g.key]),
);

/**
 * Resolve an EVE-emitted "Group" cell to a `SignatureGroupKey`, or `null`
 * if the cell doesn't match any known scanner group.
 */
export function signatureGroupKeyFromScannerName(
  scannerName: string | null | undefined,
): SignatureGroupKey | null {
  if (!scannerName) return null;
  const direct = scannerNameToKey.get(scannerName.toLowerCase());
  if (direct) return direct;
  const lower = scannerName.toLowerCase();
  for (const g of SIGNATURE_GROUP_CATALOG) {
    if (lower.startsWith(g.scannerName.toLowerCase())) return g.key;
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
