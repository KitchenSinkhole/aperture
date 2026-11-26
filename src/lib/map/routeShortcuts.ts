import 'server-only';
import { getGateGraph } from './routePlanner';

export type RouteShortcutKind = 'nearest_highsec';

/**
 * Gate-graph BFS from `sourceSystemId` until the first system with `true_sec >= 0.5`
 * (high-sec). Returns null when the source sits on an unreachable island.
 */
export async function resolveRouteShortcut(
  kind: RouteShortcutKind,
  sourceSystemId: number,
): Promise<number | null> {
  if (kind !== 'nearest_highsec') return null;
  const { adjacency, trueSec } = await getGateGraph();
  const queue: number[] = [sourceSystemId];
  const seen = new Set<number>([sourceSystemId]);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const sec = trueSec.get(id);
    if (id !== sourceSystemId && sec != null && sec >= 0.45) return id;
    for (const next of adjacency.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return null;
}
