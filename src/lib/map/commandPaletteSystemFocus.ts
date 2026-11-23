import type { MapSystemNode } from '@/lib/map/loadMap';
import { systemDisplayName } from '@/lib/eve/drifterSystems';

export type SystemFocusMatchRank = 'exact-tag' | 'name-prefix';

export type SystemFocusMatch = {
  system: MapSystemNode;
  rank: SystemFocusMatchRank;
};

/**
 * Ranked matches for command-palette / jump "focus system" queries.
 * Exact tag match first, then name / alias / display-name prefix (case-insensitive).
 */
export function matchSystemsForFocus(
  systems: readonly MapSystemNode[],
  query: string,
): SystemFocusMatch[] {
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();

  const out: SystemFocusMatch[] = [];

  for (const system of systems) {
    const tag = system.tag?.trim() ?? '';
    if (tag.length > 0 && tag.toLowerCase() === qLower) {
      out.push({ system, rank: 'exact-tag' });
      continue;
    }

    const alias = system.alias?.trim() ?? '';
    const name = system.name.trim();
    const display = systemDisplayName(system.systemId, name);
    const hay = [name, alias, display]
      .filter((s) => s.length > 0)
      .map((s) => s.toLowerCase());

    if (hay.some((s) => s.startsWith(qLower))) {
      out.push({ system, rank: 'name-prefix' });
    }
  }

  out.sort((a, b) => {
    const rankOrder = (r: SystemFocusMatchRank) => (r === 'exact-tag' ? 0 : 1);
    const d = rankOrder(a.rank) - rankOrder(b.rank);
    if (d !== 0) return d;
    const labelA = (a.system.alias?.trim() || systemDisplayName(a.system.systemId, a.system.name)).toLowerCase();
    const labelB = (b.system.alias?.trim() || systemDisplayName(b.system.systemId, b.system.name)).toLowerCase();
    return labelA.localeCompare(labelB);
  });

  return out;
}

export function focusSystemActionLabel(system: MapSystemNode): string {
  const alias = system.alias?.trim();
  if (alias) return alias;
  return systemDisplayName(system.systemId, system.name);
}
