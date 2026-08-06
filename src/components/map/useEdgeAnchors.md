## useEdgeAnchors.ts

**Purpose:** Per-edge hook resolving one connection's own attachment points on its source/target node faces, fanned out among the other edges sharing that face.
**File:** `src/components/map/useEdgeAnchors.ts`

`'use client'`; wraps `src/lib/map/edgeAnchors.ts`'s pure geometry (`pickFace`, `faceRank`, `anchorPoint`, `center`) in an xyflow `useStore` subscription.

---

### useEdgeAnchors(edgeId: string, sourceId: string, targetId: string): EdgeAnchors | null
Returns `{ source: EdgeAnchor; target: EdgeAnchor }` (`EdgeAnchor = { x, y, position: Position, pitch: number }`), or `null` while either endpoint node is unmeasured (caller falls back to the `sourceX/Y/Position` / `targetX/Y/Position` props xyflow supplies, and typically passes `pitch: 0`). `pitch` is this end's `facePitch` for the face it sits on — `0` when the edge is the only one on that face — and is what a consumer sizing a per-endpoint hit target clamps its along-face extent against.

Per store update: reads both endpoints' geometry from `nodeLookup`, calls `pickFace` for the node-pair's dominant-axis face pair, builds each endpoint's incident-edge list from an adjacency index derived from `state.edges` (not `state.connectionLookup` — its keying by handle pair collapses two null-handle parallel edges between the same node pair onto one entry), ranks it with `faceRank`, and resolves this edge's own point with `anchorPoint` plus its `facePitch`. If this edge is transiently absent from a ranking (store lag between an edge being added and the lookup catching up), it centres on the face as the sole occupant (`anchorPoint(rect, face, 0, 1)`, `pitch: 0`) rather than throwing.

The adjacency index is memoised in a module-level `WeakMap` keyed on the `edges` array reference, so it rebuilds only when the connection set changes, not on every drag-frame position update. Result equality (eight numeric/enum fields, `pitch` included) is passed to `useStore` as its equality function, so a component only re-renders when its own two anchor points or their pitch actually move — same selectivity `useInternalNode` gave, extended to cover face-fan rank and crowding changes among neighbours. Comparing `pitch` matters on its own: a degree change on a face can leave this edge's coordinates untouched (e.g. the centre anchor of a 3-fan is also the centre of a 5-fan) while still changing how tightly packed its neighbours are.

**Returns:** `EdgeAnchors | null`.
