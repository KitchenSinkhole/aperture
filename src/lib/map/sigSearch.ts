import type { MapSignature, MapSystemNode, SigSearchFilters } from '@/types';
import { effectiveSignatureActivity } from '@/lib/map/siteActivity';

export type SigSearchRow = {
  sig: MapSignature;
  system: MapSystemNode;
  ageMs: number;
};

export type SigSortField = 'sigId' | 'systemName' | 'age';
export type SigSortDir = 'asc' | 'desc';

/**
 * Filters and sorts `signatures` against `filters`, joining each to its parent
 * system. Signatures whose `mapSystemId` is not in `systems` are dropped.
 * `now` is a Unix-epoch ms value (pass `Date.now()`).
 */
export function buildSigSearchResults(
  signatures: MapSignature[],
  systems: MapSystemNode[],
  filters: SigSearchFilters,
  sortField: SigSortField,
  sortDir: SigSortDir,
  now: number,
): SigSearchRow[] {
  const systemMap = new Map(systems.map((s) => [s.id, s]));
  const nameLower = filters.name.trim().toLowerCase();
  const maxAgeMs = filters.maxAgeHours !== null ? filters.maxAgeHours * 3_600_000 : null;

  const rows: SigSearchRow[] = [];
  for (const sig of signatures) {
    const system = systemMap.get(sig.mapSystemId);
    if (!system) continue;

    if (nameLower && !(sig.name?.toLowerCase().includes(nameLower) ?? false)) continue;
    if (filters.groupKey !== null && sig.groupKey !== filters.groupKey) continue;
    // The class toggles gate sigs whose class is known; a sig with no class
    // (classKind null) matches neither and always shows.
    if (sig.classKind === 'anomaly' && !filters.includeAnomalies) continue;
    if (sig.classKind === 'signature' && !filters.includeSignatures) continue;
    if (filters.activity !== null && effectiveSignatureActivity(sig) !== filters.activity) continue;
    if (
      filters.securityClasses.length > 0 &&
      (system.security === null || !filters.securityClasses.includes(system.security))
    ) continue;

    const ageMs = now - new Date(sig.createdAt).getTime();
    if (maxAgeMs !== null && ageMs > maxAgeMs) continue;

    rows.push({ sig, system, ageMs });
  }

  rows.sort((a, b) => {
    let cmp = 0;
    if (sortField === 'sigId') {
      cmp = a.sig.sigId.localeCompare(b.sig.sigId);
    } else if (sortField === 'systemName') {
      const aName = a.system.alias ?? a.system.name;
      const bName = b.system.alias ?? b.system.name;
      cmp = aName.localeCompare(bName);
    } else {
      cmp = a.ageMs - b.ageMs;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return rows;
}
