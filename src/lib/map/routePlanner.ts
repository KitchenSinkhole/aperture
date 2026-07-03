import 'server-only';
import { aliasedTable, and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapConnection, apMapSystem, universeStargateEdge, universeSystem } from '@/db/schema';
import { loadTheraConnections } from './thera';
import { recordRoutePlan } from '@/lib/metrics/registry';
import type { RouteHop, RoutePlan, RoutePrefs, WhJumpMass } from '@/types';

/**
 * Route-planner core (routes-module).
 *
 * Computes the shortest path from a picked character's current system to each
 * saved destination over a graph that overlays the live wormhole chain (and,
 * optionally, the public EVE-Scout Thera/Turnur network) on top of the static
 * K-space stargate graph. Split into a cached static layer, a per-request live
 * overlay loader, and a pure, DB-free Dijkstra (`planRoutesOnGraph`) that the
 * unit tests drive directly.
 *
 * Read-only: nothing here writes to the DB or emits an `ap_map_event`.
 */

/** A traversable non-gate edge overlaid on the stargate graph. Bidirectional. */
export type RouteOverlayEdge = {
  from: number;
  to: number;
  /** How the hop is labelled in the breadcrumb. */
  kind: 'wh' | 'jumpbridge' | 'eve_scout';
  /** `ap_map_connection.id` for a mapped link; null for EVE-Scout. */
  connectionId: number | null;
  /** Max ship size for a wormhole; null = unknown/not a wormhole (never filtered out). */
  jumpMassClass: WhJumpMass | null;
  massStatus: 'fresh' | 'reduced' | 'critical' | null;
  eolStage: 'none' | 'eol' | 'critical' | null;
};

type GateGraph = { adjacency: Map<number, number[]>; trueSec: Map<number, number> };

// Process-lifetime cache: the SDE stargate graph is static, and a re-ingest
// requires a restart anyway (mirrors the in-process caching rule in CLAUDE.md).
let gateGraphPromise: Promise<GateGraph> | null = null;

/**
 * The cached undirected K-space stargate adjacency plus each system's `true_sec`
 * (for safety weighting). Loaded once and memoized for the process lifetime.
 */
export function getGateGraph(): Promise<GateGraph> {
  if (!gateGraphPromise) gateGraphPromise = loadGateGraph();
  return gateGraphPromise;
}

async function loadGateGraph(): Promise<GateGraph> {
  const [edges, systems] = await Promise.all([
    db
      .select({ from: universeStargateEdge.fromSystemId, to: universeStargateEdge.toSystemId })
      .from(universeStargateEdge),
    db.select({ id: universeSystem.id, trueSec: universeSystem.trueSec }).from(universeSystem),
  ]);
  const adjacency = new Map<number, number[]>();
  // Stargates are bidirectional; index both directions defensively (the SDE may
  // list only one).
  for (const e of edges) {
    pushEdge(adjacency, e.from, e.to);
    pushEdge(adjacency, e.to, e.from);
  }
  const trueSec = new Map<number, number>();
  for (const s of systems) if (s.trueSec != null) trueSec.set(s.id, s.trueSec);
  return { adjacency, trueSec };
}

function pushEdge(adjacency: Map<number, number[]>, from: number, to: number): void {
  const list = adjacency.get(from);
  if (list) list.push(to);
  else adjacency.set(from, [to]);
}

/**
 * The map's wormhole + jumpbridge connections as overlay edges keyed by EVE
 * solar-system id (resolved from each endpoint's `ap_map_system`). Only links
 * between two currently-visible systems are returned; `stargate`/`abyssal`
 * connections are skipped (gates are already in the static graph; abyssals
 * aren't a normal route).
 */
export async function loadMapWormholeEdges(mapId: bigint): Promise<RouteOverlayEdge[]> {
  const src = aliasedTable(apMapSystem, 'src');
  const tgt = aliasedTable(apMapSystem, 'tgt');
  const rows = await db
    .select({
      connectionId: apMapConnection.id,
      scope: apMapConnection.scope,
      massStatus: apMapConnection.massStatus,
      jumpMassClass: apMapConnection.jumpMassClass,
      eolStage: apMapConnection.eolStage,
      fromSystemId: src.systemId,
      toSystemId: tgt.systemId,
    })
    .from(apMapConnection)
    .innerJoin(src, eq(apMapConnection.sourceMapSystemId, src.id))
    .innerJoin(tgt, eq(apMapConnection.targetMapSystemId, tgt.id))
    .where(and(eq(apMapConnection.mapId, mapId), eq(src.visible, true), eq(tgt.visible, true)));

  const overlay: RouteOverlayEdge[] = [];
  for (const r of rows) {
    if (r.scope !== 'wh' && r.scope !== 'jumpbridge') continue;
    const isWh = r.scope === 'wh';
    overlay.push({
      from: r.fromSystemId,
      to: r.toSystemId,
      kind: isWh ? 'wh' : 'jumpbridge',
      connectionId: Number(r.connectionId),
      jumpMassClass: isWh ? r.jumpMassClass : null,
      massStatus: isWh ? r.massStatus : null,
      eolStage: isWh ? r.eolStage : null,
    });
  }
  return overlay;
}

/** The public EVE-Scout Thera/Turnur connections as `eve_scout` overlay edges. */
export async function loadEveScoutEdges(): Promise<RouteOverlayEdge[]> {
  const conns = await loadTheraConnections();
  return conns.map((c) => ({
    from: c.hubSystemId,
    to: c.targetSystemId,
    kind: 'eve_scout' as const,
    connectionId: null,
    jumpMassClass: null,
    massStatus: null,
    eolStage: null,
  }));
}

/**
 * The map's currently-visible systems: the id set (for `onMap`) plus each
 * system's user-assigned `tag` (for the breadcrumb tooltip), keyed by EVE
 * solar-system id. Untagged systems are absent from `tags`.
 */
async function loadMapSystems(mapId: bigint): Promise<{ ids: Set<number>; tags: Map<number, string> }> {
  const rows = await db
    .select({ systemId: apMapSystem.systemId, tag: apMapSystem.tag })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.visible, true)));
  const ids = new Set<number>();
  const tags = new Map<number, string>();
  for (const r of rows) {
    ids.add(r.systemId);
    if (r.tag) tags.set(r.systemId, r.tag);
  }
  return { ids, tags };
}

const SHIP_RANK: Record<WhJumpMass, number> = { s: 0, m: 1, l: 2, xl: 3 };

/** True if a wormhole is large enough and not in an avoided mass/EOL state. */
function edgePassesFilters(e: RouteOverlayEdge, prefs: RoutePrefs): boolean {
  if (prefs.minShipClass && e.jumpMassClass && SHIP_RANK[e.jumpMassClass] < SHIP_RANK[prefs.minShipClass]) {
    return false;
  }
  if (e.kind === 'wh') {
    if (prefs.avoidReduced && e.massStatus === 'reduced') return false;
    if (prefs.avoidCritical && e.massStatus === 'critical') return false;
    if (prefs.avoidEol && e.eolStage && e.eolStage !== 'none') return false;
  }
  return true;
}

/**
 * Extra Dijkstra cost for *entering* a system, by safety mode. `safer` makes
 * low/null transit expensive enough to lose to any all-highsec alternative but
 * never infinite, so a reachable destination is always returned. `less_safe`
 * inverts it. Unknown security (J-space / missing `true_sec`) counts as null.
 */
function safetyPenalty(systemId: number, trueSec: Map<number, number>, prefs: RoutePrefs): number {
  if (prefs.safety === 'shortest') return 0;
  const sec = trueSec.get(systemId);
  const band = sec == null ? 'null' : sec >= 0.45 ? 'high' : sec > 0 ? 'low' : 'null';
  if (prefs.safety === 'safer') return band === 'high' ? 0 : band === 'low' ? 50 : 100;
  return band === 'high' ? 50 : 0; // less_safe
}

type RawHop = Omit<RouteHop, 'name' | 'security' | 'securityStatus' | 'tag'>;
type RawRoutePlan = {
  destinationSystemId: number;
  reachable: boolean;
  jumps: number;
  hops: RawHop[];
};

type Predecessor = { prev: number; via: RouteHop['via']; connectionId: number | null };

export type PlanGraphInput = {
  adjacency: Map<number, number[]>;
  trueSec: Map<number, number>;
  overlay: RouteOverlayEdge[];
  onMapSystemIds: Set<number>;
  sourceSystemId: number;
  destinationSystemIds: number[];
  prefs: RoutePrefs;
};

/**
 * Pure weighted shortest-path (DB-free). One Dijkstra from the source reaches
 * every destination; per-destination paths are reconstructed from the shared
 * predecessor map. Edge weight is `1 + safetyPenalty(entered)`, but the reported
 * `jumps` is the true hop count, independent of the safety weighting.
 */
export function planRoutesOnGraph(input: PlanGraphInput): RawRoutePlan[] {
  const { adjacency, trueSec, overlay, onMapSystemIds, sourceSystemId, destinationSystemIds, prefs } =
    input;

  // Build a filtered, bidirectional overlay adjacency once.
  const overlayAdj = new Map<number, Array<{ to: number; via: RouteHop['via']; connectionId: number | null }>>();
  const addOverlay = (from: number, to: number, via: RouteHop['via'], connectionId: number | null) => {
    const list = overlayAdj.get(from);
    const entry = { to, via, connectionId };
    if (list) list.push(entry);
    else overlayAdj.set(from, [entry]);
  };
  for (const e of overlay) {
    if (!edgePassesFilters(e, prefs)) continue;
    addOverlay(e.from, e.to, e.kind, e.connectionId);
    addOverlay(e.to, e.from, e.kind, e.connectionId);
  }

  const dist = new Map<number, number>([[sourceSystemId, 0]]);
  const pred = new Map<number, Predecessor>();
  const settled = new Set<number>();
  const heap = new MinHeap();
  heap.push(sourceSystemId, 0);

  while (heap.size > 0) {
    const u = heap.pop()!;
    if (settled.has(u)) continue;
    settled.add(u);
    const baseDist = dist.get(u)!;

    const relax = (v: number, via: RouteHop['via'], connectionId: number | null) => {
      const nd = baseDist + 1 + safetyPenalty(v, trueSec, prefs);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        pred.set(v, { prev: u, via, connectionId });
        heap.push(v, nd);
      }
    };

    for (const v of adjacency.get(u) ?? []) relax(v, 'gate', null);
    for (const e of overlayAdj.get(u) ?? []) relax(e.to, e.via, e.connectionId);
  }

  const onMap = (systemId: number): boolean => onMapSystemIds.has(systemId);
  return destinationSystemIds.map((destinationSystemId) => {
    if (!dist.has(destinationSystemId)) {
      return { destinationSystemId, reachable: false, jumps: 0, hops: [] };
    }
    // Walk predecessors back to the source, then reverse into source→dest order.
    const reversed: RawHop[] = [];
    let cursor = destinationSystemId;
    for (;;) {
      const p = pred.get(cursor);
      if (!p) {
        reversed.push({ systemId: cursor, via: 'origin', connectionId: null, onMap: onMap(cursor) });
        break;
      }
      reversed.push({ systemId: cursor, via: p.via, connectionId: p.connectionId, onMap: onMap(cursor) });
      cursor = p.prev;
    }
    const hops = reversed.reverse();
    return { destinationSystemId, reachable: true, jumps: hops.length - 1, hops };
  });
}

/**
 * End-to-end planner: cached gate graph + this map's live overlay (+ optional
 * EVE-Scout), Dijkstra, then enrich hops with system name/security for display.
 */
export async function planRoutes(args: {
  mapId: bigint;
  sourceSystemId: number;
  destinationSystemIds: number[];
  prefs: RoutePrefs;
}): Promise<RoutePlan[]> {
  const start = performance.now();
  try {
    const { mapId, sourceSystemId, destinationSystemIds, prefs } = args;
    const { adjacency, trueSec } = await getGateGraph();
    const [whEdges, scoutEdges, mapSystems] = await Promise.all([
      loadMapWormholeEdges(mapId),
      prefs.includeEveScout ? loadEveScoutEdges() : Promise.resolve<RouteOverlayEdge[]>([]),
      loadMapSystems(mapId),
    ]);
    const raw = planRoutesOnGraph({
      adjacency,
      trueSec,
      overlay: [...whEdges, ...scoutEdges],
      onMapSystemIds: mapSystems.ids,
      sourceSystemId,
      destinationSystemIds,
      prefs,
    });
    return await enrichPlans(raw, mapSystems.tags);
  } finally {
    recordRoutePlan(performance.now() - start);
  }
}

/** Batch-resolve name/security for every system in every path and fold into RoutePlans. */
async function enrichPlans(raw: RawRoutePlan[], tags: Map<number, string>): Promise<RoutePlan[]> {
  const ids = new Set<number>();
  for (const plan of raw) {
    ids.add(plan.destinationSystemId);
    for (const hop of plan.hops) ids.add(hop.systemId);
  }
  const info = new Map<
    number,
    { name: string; security: string | null; securityStatus: number | null }
  >();
  if (ids.size > 0) {
    const rows = await db
      .select({
        id: universeSystem.id,
        name: universeSystem.name,
        security: universeSystem.security,
        securityStatus: universeSystem.securityStatus,
      })
      .from(universeSystem)
      .where(inArray(universeSystem.id, [...ids]));
    for (const r of rows)
      info.set(r.id, { name: r.name, security: r.security, securityStatus: r.securityStatus });
  }
  const nameOf = (id: number) => info.get(id)?.name ?? `System ${id}`;

  return raw.map((plan) => ({
    destinationSystemId: plan.destinationSystemId,
    destinationName: nameOf(plan.destinationSystemId),
    reachable: plan.reachable,
    jumps: plan.jumps,
    hops: plan.hops.map((hop) => ({
      ...hop,
      name: nameOf(hop.systemId),
      security: info.get(hop.systemId)?.security ?? null,
      securityStatus: info.get(hop.systemId)?.securityStatus ?? null,
      tag: tags.get(hop.systemId) ?? null,
    })),
  }));
}

/** Minimal binary min-heap over (node, dist) pairs. Lazy-deletes stale entries. */
class MinHeap {
  private nodes: number[] = [];
  private dists: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, dist: number): void {
    this.nodes.push(node);
    this.dists.push(dist);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.dists[parent]! <= this.dists[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0]!;
    const lastNode = this.nodes.pop()!;
    const lastDist = this.dists.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.dists[0] = lastDist;
      let i = 0;
      const n = this.nodes.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.dists[l]! < this.dists[smallest]!) smallest = l;
        if (r < n && this.dists[r]! < this.dists[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!];
    [this.dists[a], this.dists[b]] = [this.dists[b]!, this.dists[a]!];
  }
}
