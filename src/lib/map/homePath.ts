import type { MapConnectionEdge } from '@/lib/map/loadMap';

/** BFS tree edges from Home — the first connection reaching each system from Home. */
export function homePathConnectionIds(
  homeMapSystemId: string | null,
  connections: readonly Pick<MapConnectionEdge, 'id' | 'source' | 'target'>[],
): ReadonlySet<string> {
  if (!homeMapSystemId) return new Set();
  const adj = new Map<string, { neighbor: string; connId: string }[]>();
  for (const c of connections) {
    const a = adj.get(c.source) ?? [];
    a.push({ neighbor: c.target, connId: c.id });
    adj.set(c.source, a);
    const b = adj.get(c.target) ?? [];
    b.push({ neighbor: c.source, connId: c.id });
    adj.set(c.target, b);
  }
  const tree = new Set<string>();
  const visited = new Set<string>([homeMapSystemId]);
  const queue = [homeMapSystemId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { neighbor, connId } of adj.get(cur) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      tree.add(connId);
      queue.push(neighbor);
    }
  }
  return tree;
}
