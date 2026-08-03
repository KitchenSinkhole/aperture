## useEdgeAnchors.ts

**Purpose:** Per-edge hook resolving one connection's own attachment points on its source/target node faces, fanned out among the other edges sharing that face.
**File:** `src/components/map/useEdgeAnchors.ts`

`'use client'`; wraps `src/lib/map/edgeAnchors.ts`'s pure geometry (`pickFace`, `faceRank`, `anchorPoint`, `center`) in an xyflow `useStore` subscription.

---

### useEdgeAnchors(edgeId: string, sourceId: string, targetId: string): EdgeAnchors | null
Returns `{ source: EdgeAnchor; target: EdgeAnchor }` (`EdgeAnchor = { x, y, position: Position }`), or `null` while either endpoint node is unmeasured (caller falls back to the `sourceX/Y/Position` / `targetX/Y/Position` props xyflow supplies).

Per store update: reads both endpoints' geometry from `nodeLookup`, calls `pickFace` for the node-pair's dominant-axis face pair, builds each endpoint's incident-edge list from an adjacency index derived from `state.edges` (not `state.connectionLookup` — its keying by handle pair collapses two null-handle parallel edges between the same node pair onto one entry), ranks it with `faceRank`, and resolves this edge's own point with `anchorPoint`. If this edge is transiently absent from a ranking (store lag between an edge being added and the lookup catching up), it centres on the face (`anchorPoint(rect, face, 0, 1)`) rather than throwing.

The adjacency index is memoised in a module-level `WeakMap` keyed on the `edges` array reference, so it rebuilds only when the connection set changes, not on every drag-frame position update. Result equality (six numeric/enum fields) is passed to `useStore` as its equality function, so a component only re-renders when its own two anchor points actually move — same selectivity `useInternalNode` gave, extended to cover face-fan rank changes among neighbours.

**Returns:** `EdgeAnchors | null`.
