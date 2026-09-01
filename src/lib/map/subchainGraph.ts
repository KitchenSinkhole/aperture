/**
 * Pure graph traversal over a map's systems and connections: the subchain
 * hanging off a system, the set cut off from Home, hop distance from Home, and
 * a system's direct neighbours. No `server-only` import — the same code runs on
 * the client (to preview/highlight a doomed set, to answer distance questions
 * for the UI) and on the server (to recompute a deletion authoritatively).
 *
 * A subchain is defined by a `head` (the system being deleted, plus its branch)
 * and an `anchor` (the keep-side root — the map's Home when one is set, else a
 * neighbour the user picks). The subchain is the head plus every system that
 * becomes unreachable from the anchor once the head is removed — i.e. the head
 * and everything hanging off it *away* from the anchor. The anchor side, the
 * head's parent (which sits between head and anchor), and any system still
 * reachable from the anchor via another route (a loop back to known space) are
 * all preserved.
 */

/** Minimal shape needed for traversal — `ap_map_system.id` as a string. */
type SystemRef = { id: string };
/** Minimal shape needed for traversal — endpoints are `ap_map_system.id`s. */
type ConnectionRef = { source: string; target: string };

/** Build an undirected adjacency map over the given systems' ids. */
function buildAdjacency(
  systems: readonly SystemRef[],
  connections: readonly ConnectionRef[],
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const s of systems) adjacency.set(s.id, new Set());
  for (const c of connections) {
    // Ignore edges whose endpoints aren't in the visible system set.
    const a = adjacency.get(c.source);
    const b = adjacency.get(c.target);
    if (!a || !b) continue;
    a.add(c.target);
    b.add(c.source);
  }
  return adjacency;
}

/** BFS reachability from `start` over `adjacency`, never entering `skip`. */
function reachable(
  adjacency: Map<string, Set<string>>,
  start: string,
  skip: string | null,
): Set<string> {
  const visited = new Set<string>();
  if (!adjacency.has(start) || start === skip) return visited;
  const queue: string[] = [start];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const nb of adjacency.get(cur) ?? []) {
      if (nb === skip || visited.has(nb)) continue;
      queue.push(nb);
    }
  }
  return visited;
}

/**
 * Resolve the subchain to delete for `headId`, anchored on `anchorId`.
 *
 * Returns the head plus every system orphaned from the anchor by removing the
 * head — computed as (reachable from anchor) minus (reachable from anchor with
 * the head removed). This keeps the head's parent and anything still reachable
 * via a loop. If the head is already disconnected from the anchor (the chain to
 * known space is already broken), the head's entire connected component is
 * returned instead.
 *
 * Returns an empty set when head and anchor are the same node or the head isn't
 * in the system set.
 */
export function computeSubchain(args: {
  systems: readonly SystemRef[];
  connections: readonly ConnectionRef[];
  headId: string;
  anchorId: string;
}): Set<string> {
  const { systems, connections, headId, anchorId } = args;
  if (headId === anchorId) return new Set();

  const adjacency = buildAdjacency(systems, connections);
  if (!adjacency.has(headId)) return new Set();

  const fromAnchor = reachable(adjacency, anchorId, null);
  if (!fromAnchor.has(headId)) {
    // Head is already cut off from the keep side — remove its whole component.
    return reachable(adjacency, headId, null);
  }

  const fromAnchorWithoutHead = reachable(adjacency, anchorId, headId);
  const out = new Set<string>();
  for (const id of fromAnchor) {
    if (!fromAnchorWithoutHead.has(id)) out.add(id); // includes headId
  }
  return out;
}

/**
 * Resolve the set of systems disconnected from `homeId` — every visible system
 * with no path back to the Home over the undirected connection graph. Powers the
 * "delete disconnected" pane action: clear out branches that went stale after a
 * hole collapsed elsewhere. The Home is reachable from itself, so it is never in
 * the result.
 *
 * Returns an empty set when `homeId` isn't in the system set.
 */
export function computeDisconnected(args: {
  systems: readonly SystemRef[];
  connections: readonly ConnectionRef[];
  homeId: string;
}): Set<string> {
  const { systems, connections, homeId } = args;
  const adjacency = buildAdjacency(systems, connections);
  if (!adjacency.has(homeId)) return new Set();

  const fromHome = reachable(adjacency, homeId, null);
  const out = new Set<string>();
  for (const s of systems) {
    if (!fromHome.has(s.id)) out.add(s.id);
  }
  return out;
}

/**
 * BFS hop distance from `homeId` to every reachable system, over the same
 * undirected, scope-agnostic graph as `computeDisconnected`.
 *
 * Returns an empty map when `homeId` is `null` or isn't in `args.systems`. A
 * system with no path back to Home is absent from the map — never inserted
 * with a sentinel value.
 */
export function hopsFromHome(args: {
  systems: readonly SystemRef[];
  connections: readonly ConnectionRef[];
  homeId: string | null;
}): Map<string, number> {
  const { systems, connections, homeId } = args;
  const out = new Map<string, number>();
  if (homeId === null) return out;

  const adjacency = buildAdjacency(systems, connections);
  if (!adjacency.has(homeId)) return out;

  out.set(homeId, 0);
  const queue: string[] = [homeId];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const dist = out.get(cur)!;
    for (const nb of adjacency.get(cur) ?? []) {
      if (out.has(nb)) continue;
      out.set(nb, dist + 1);
      queue.push(nb);
    }
  }
  return out;
}

/**
 * Direct neighbours of `systemId` over the undirected graph. Powers the
 * no-Home fallback submenu, where the user picks which neighbour to keep.
 * Deduplicated and order-stable by first appearance in `connections`.
 */
export function neighborsOf(
  connections: readonly ConnectionRef[],
  systemId: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of connections) {
    const other = c.source === systemId ? c.target : c.target === systemId ? c.source : null;
    if (other === null || seen.has(other)) continue;
    seen.add(other);
    out.push(other);
  }
  return out;
}
