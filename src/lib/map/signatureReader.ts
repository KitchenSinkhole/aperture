import 'server-only';
import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { universeWormhole } from '@/db/schema';
import type { SignatureGroupKey } from '@/types';
import type { ParsedSigRow } from './signatureParser';
import { isScannerGroupName, signatureGroupKeyFromScannerName } from './signatureGroups';

/**
 * Signature paste resolver — server-only `(groupName, name)` → `(groupKey, typeId)`
 * mapping for parsed probe-scanner rows.
 *
 * The pure parser (`parseSignaturePaste`) lives in a sibling
 * `signatureParser.ts` so the paste dialog can import it without dragging this
 * module's DB client into the client bundle.
 *
 * Resolution model:
 *   - `groupKey` is derived from the scanner-emitted Group cell via a static
 *     catalog (`signatureGroupKeyFromScannerName`). No DB hit — the seven
 *     scanner-level groups are a `pgEnum`, not `universe_group` rows.
 *   - `typeId` is meaningful only when `groupKey === 'wormhole'`. For those
 *     rows the parsed `name` cell (e.g. `'B274'`, `'K162'`) is matched against
 *     `universe_wormhole.name` in a single bulk lookup.
 *   - For the six cosmic groups, the parsed `name` is carried through verbatim
 *     (the EVE site name string is not in the SDE — see `signatureGroups.ts`).
 *   - Low-strength names are nulled out: if the Name cell is blank, equals
 *     the Group cell verbatim (the scanner returns "Wormhole"/"Wormhole" at
 *     low strength), or matches the static scanner group label
 *     ("Combat Site", etc.), we treat the name as unresolvable.
 */

export type ResolvedSigRow = ParsedSigRow & {
  groupKey: SignatureGroupKey | null;
  typeId: number | null;
};

export async function resolveSignatureRows(
  rows: ParsedSigRow[],
): Promise<ResolvedSigRow[]> {
  if (rows.length === 0) return [];

  const classified = rows.map((r) => {
    const groupKey = signatureGroupKeyFromScannerName(r.groupName);
    const name = filterLowStrengthName(r.name, r.groupName);
    return { row: r, groupKey, name };
  });

  const wormholeNames = new Set<string>();
  for (const c of classified) {
    if (c.groupKey === 'wormhole' && c.name) wormholeNames.add(c.name);
  }

  const nameToTypeId = new Map<string, number>();
  if (wormholeNames.size > 0) {
    const wormholes = await db
      .select({ typeId: universeWormhole.typeId, name: universeWormhole.name })
      .from(universeWormhole)
      .where(inArray(universeWormhole.name, [...wormholeNames]));
    for (const w of wormholes) nameToTypeId.set(w.name, w.typeId);
  }

  return classified.map(({ row, groupKey, name }) => {
    const typeId =
      groupKey === 'wormhole' && name ? (nameToTypeId.get(name) ?? null) : null;
    return { ...row, name, groupKey, typeId };
  });
}

/**
 * Drop scanner-emitted names that carry no information. At low scan strength
 * EVE either leaves the Name cell blank or repeats the Group cell ("Wormhole"
 * paired with "Wormhole" is the canonical case). Persisting those would
 * pollute the inspector.
 */
function filterLowStrengthName(name: string | null, groupName: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  if (groupName && trimmed.toLowerCase() === groupName.trim().toLowerCase()) return null;
  // Block the static scanner labels too — covers "Combat Site" appearing in
  // the Name cell at low strength. Exact match only: the Drifter combat sites
  // are named "Unstable Wormhole", "Caged Wormhole" and the like.
  if (isScannerGroupName(trimmed)) return null;
  return trimmed;
}
