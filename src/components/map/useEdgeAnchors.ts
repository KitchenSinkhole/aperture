'use client';

import { useCallback } from 'react';
import { useStore, type Edge, type InternalNode, type Node, type ReactFlowState } from '@xyflow/react';
import { Position } from '@xyflow/react';
import { anchorPoint, center, facePitch, faceRank, pickFace, type Rect } from '@/lib/map/edgeAnchors';

export type EdgeAnchor = { x: number; y: number; position: Position; pitch: number };
export type EdgeAnchors = { source: EdgeAnchor; target: EdgeAnchor };

type Adjacency = Map<string, { id: string; other: string }[]>;

// Keyed on the `edges` array reference MapCanvas passes to <ReactFlow>, which
// is stable across drag frames (it only depends on the connection set, not
// node positions) — so this rebuilds only when connections actually change,
// not on every store update a drag produces.
const adjacencyCache = new WeakMap<Edge[], Adjacency>();

function adjacencyOf(edges: Edge[]): Adjacency {
  const cached = adjacencyCache.get(edges);
  if (cached) return cached;
  const adj: Adjacency = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push({ id: e.id, other: e.target });
    adj.get(e.target)!.push({ id: e.id, other: e.source });
  }
  adjacencyCache.set(edges, adj);
  return adj;
}

function rectOf(node: InternalNode<Node> | undefined): Rect | null {
  const pos = node?.internals.positionAbsolute;
  const w = node?.measured.width;
  const h = node?.measured.height;
  if (!pos || !w || !h) return null;
  return { x: pos.x, y: pos.y, w, h };
}

function endpointAnchor(
  nodeLookup: ReactFlowState['nodeLookup'],
  adj: Adjacency,
  nodeId: string,
  rect: Rect,
  face: Position,
  edgeId: string,
): EdgeAnchor {
  const nodeCenter = center(rect);
  const incident = (adj.get(nodeId) ?? [])
    .map(({ id, other }) => {
      const otherRect = rectOf(nodeLookup.get(other));
      return otherRect ? { id, otherCenter: center(otherRect) } : null;
    })
    .filter((e): e is { id: string; otherCenter: { x: number; y: number } } => e !== null);

  const ranked = faceRank(incident, nodeCenter, face);
  const index = ranked.indexOf(edgeId);
  const count = index === -1 ? 1 : ranked.length;
  const { x, y } = anchorPoint(rect, face, index === -1 ? 0 : index, count);
  return { x, y, position: face, pitch: facePitch(rect, face, count) };
}

function anchorsEqual(a: EdgeAnchors | null, b: EdgeAnchors | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.source.x === b.source.x &&
    a.source.y === b.source.y &&
    a.source.position === b.source.position &&
    a.source.pitch === b.source.pitch &&
    a.target.x === b.target.x &&
    a.target.y === b.target.y &&
    a.target.position === b.target.position &&
    a.target.pitch === b.target.pitch
  );
}

/**
 * Resolves one edge's own attachment points on its source/target node faces,
 * fanned out among the other edges sharing that face. Subscribes only to the
 * two endpoint nodes' geometry and the edge list (for adjacency), so a drag
 * re-renders only the edges whose own anchors actually moved — the same
 * selectivity `useInternalNode` gives, extended to face-fan ranking.
 */
export function useEdgeAnchors(edgeId: string, sourceId: string, targetId: string): EdgeAnchors | null {
  const selector = useCallback(
    (state: ReactFlowState): EdgeAnchors | null => {
      const srcRect = rectOf(state.nodeLookup.get(sourceId));
      const tgtRect = rectOf(state.nodeLookup.get(targetId));
      if (!srcRect || !tgtRect) return null;

      const faces = pickFace(srcRect, tgtRect);
      const adj = adjacencyOf(state.edges);
      return {
        source: endpointAnchor(state.nodeLookup, adj, sourceId, srcRect, faces.source, edgeId),
        target: endpointAnchor(state.nodeLookup, adj, targetId, tgtRect, faces.target, edgeId),
      };
    },
    [edgeId, sourceId, targetId],
  );

  return useStore(selector, anchorsEqual);
}
