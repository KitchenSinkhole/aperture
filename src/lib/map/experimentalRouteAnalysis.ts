import type {
  MapConnectionEdge,
  MapPresenceEntry,
  RouteHop,
  RoutePlan,
  SystemIntelSummary,
  SystemStatsSummary,
} from '@/types';

export type RouteAnalysisLine = { label: string; value: string };

/**
 * Lightweight client summary for a computed plan: kills (when stats exist),
 * wormhole mass/EOL on hops, and pilot names in traversed on-map systems.
 */
export function summarizeRoutePlan(args: {
  plan: RoutePlan;
  connections: MapConnectionEdge[];
  stats: Record<number, SystemStatsSummary | undefined>;
  presence: MapPresenceEntry[];
  intel: Record<number, SystemIntelSummary | undefined>;
}): RouteAnalysisLine[] {
  const { plan, connections, stats, presence, intel } = args;
  if (!plan.reachable) return [{ label: 'Route', value: 'Unreachable' }];

  const connById = new Map(connections.map((c) => [c.id, c]));
  const systemIds = new Set(plan.hops.map((h) => h.systemId));
  let kills = 0;
  for (const id of systemIds) {
    const row = stats[id];
    if (row) kills += row.shipKills + row.podKills;
  }

  const whNotes: string[] = [];
  for (const hop of plan.hops) {
    if (hop.via !== 'wh' || hop.connectionId == null) continue;
    const c = connById.get(String(hop.connectionId));
    if (!c) continue;
    const bits: string[] = [];
    if (c.massStatus && c.massStatus !== 'fresh') bits.push(c.massStatus);
    if (c.eolStage && c.eolStage !== 'none') bits.push(`EOL ${c.eolStage}`);
    if (c.jumpMassClass) bits.push(c.jumpMassClass.toUpperCase());
    if (bits.length > 0) whNotes.push(`${hop.name}: ${bits.join(', ')}`);
  }

  const pilots = new Set<string>();
  for (const p of presence) {
    if (!systemIds.has(p.systemId)) continue;
    pilots.add(p.characterName);
  }

  const lines: RouteAnalysisLine[] = [
    { label: 'Jumps', value: String(plan.jumps) },
    { label: 'Kills (24h)', value: kills > 0 ? String(kills) : '—' },
  ];

  const incursions = [...systemIds].filter((id) => intel[id]?.incursion != null).length;
  if (incursions > 0) lines.push({ label: 'Incursion systems', value: String(incursions) });

  if (whNotes.length > 0) {
    lines.push({ label: 'WH hops', value: whNotes.slice(0, 4).join('; ') });
  }
  if (pilots.size > 0) {
    const names = [...pilots].slice(0, 6);
    const tail = pilots.size > names.length ? ` +${pilots.size - names.length}` : '';
    lines.push({ label: 'Pilots on path', value: names.join(', ') + tail });
  }
  return lines;
}

export function connectionMetaForHop(
  hop: RouteHop,
  connections: MapConnectionEdge[],
): MapConnectionEdge | null {
  if (hop.connectionId == null) return null;
  return connections.find((c) => c.id === String(hop.connectionId)) ?? null;
}
