# Edge Face Fan

**Goal:** Give every connection its own attachment point on a node face, so two systems joined by several holes no longer emit them all from one pixel, and so a label placed beside an attachment point is unambiguously attributable to one connection.

**References:**
- `src/components/map/ConnectionEdge.md` (interactive edge; `pickAnchors` behaviour is documented under Behaviour & Interactions)
- `src/components/public/PublicConnectionEdge.md` (spectator edge)
- `src/components/map/MapCanvas.md` (builds `parallelIndex` / `parallelCount`, around line 1810)
- `src/components/public/SpectatorMap.md` (same, around line 58)
- CLAUDE.md: "Don't add features, refactor, or introduce abstractions beyond what the task requires"

---

## Background

`pickAnchors` is duplicated verbatim in two places: `src/components/map/ConnectionEdge.tsx:50` and `src/components/public/PublicConnectionEdge.tsx:46`, along with `PARALLEL_STEP_PX = 12`. Both pick a node face from the dominant axis of the centre-to-centre delta and return a single point on that face.

The `offset` that separates edges applies only to **parallel edges between the same node pair**, fed by `parallelIndex` / `parallelCount`. Two connections from the *same* node to *different* neighbours that resolve to the same face therefore share one attachment point exactly. On the current test map, J160941's three right-side connections (to J155203, J125247 and Kamela) all leave from one point and only separate along the bezier.

This is invisible enough to have gone unnoticed, but it blocks placing per-endpoint labels against a node face, which is what the spectator sig tags need (see `docs/plans/public-map-spectator-polish.md`).

**Consequence for the interactive map:** wiring this up changes the appearance of the main canvas. Nodes with several connections on one face will visibly fan where they currently converge. This is an improvement, but it is a visible change to the product's core surface arriving as a side effect of spectator work, so Stage 2 should be its own commit with a message that says so.

---

## Design notes

Settle these in Stage 1 before writing the module.

### Face assignment
Unchanged. Dominant axis of the centre-to-centre delta, oriented so the source side faces the target. Nothing about the existing rule is wrong.

### Ordering within a face
Sort the edges attached to one face by their departure angle, measured from the near node's centre to the far endpoint's centre:

| Face | Sort key |
|---|---|
| Left, Right | `dy / abs(dx)`, ascending |
| Top, Bottom | `dx / abs(dy)`, ascending |

Face selection guarantees the along-axis distance dominates, so the ratio stays in `[-1, 1]` and is monotonic in angle across the face. A neighbour coincident with the node centre ranks as zero angle.

Ties (two holes to the same neighbour) break by connection id, so ordering is stable across renders and across the two canvases.

This makes the fan non-crossing in the immediate neighbourhood of the node: the topmost attachment point belongs to the edge heading furthest up. That correspondence is what lets a reader map a label to a line by rank without tracing it.

The far endpoint's raw perpendicular coordinate is *not* a sufficient key. It agrees with the angle only when every neighbour sits at roughly the same distance; once one is dragged well out, it can sit higher than a nearer neighbour while heading away at a shallower angle, and the higher anchor then crosses the two lines right at the face.

### Distribution
For index `i` of `n` on a face, `offset = (i - (n - 1) / 2) * pitch`, applied along the face's perpendicular axis. This is the existing formula; only the grouping key changes, from "node pair" to "node face".

`parallelIndex` / `parallelCount` are fully subsumed and should be **deleted** from both edge data shapes and from both canvas memos, not left alongside.

### Pitch and clamping (open)
Base pitch is 12 px today. Two unresolved tensions, both to be settled visually in Stage 2:

- A node face is roughly 30 px tall. Five edges at 12 px pitch spans 48 px and spills past the node corners, so the line appears to leave from beside the tile rather than from it. Proposed fix: `pitch = min(BASE_PITCH, (faceLength - margin) / (n - 1))`, so pitch shrinks as degree grows and the fan always stays on the face.
- The spectator sig tags need roughly 16 px of vertical room each to stack without touching. That wants a *larger* pitch, which fights the clamp above.

Do not resolve this by guessing. Land Stage 2 with the clamp, look at a real chain, and carry the number into Stage 3.

### Reactivity (the decision that drives the staging)
On the spectator map, positions come from the snapshot and change rarely, so computing the whole face map once and putting it in context is fine. That design is wrong for the interactive map, where `nodeLookup` mutates on every drag frame and a context provider would re-render every edge at 60 fps. Today xyflow keeps this selective: each edge subscribes only to its two endpoint nodes via `useInternalNode`, so only edges touching the dragged node re-render.

Three candidates:

| Approach | Preserves render selectivity | Notes |
|---|---|---|
| Compute in the canvas memo, pass down as edge data | No | Recomputes the entire edges array on every position change |
| Shared context provider | No | Re-renders every edge whenever any node moves |
| **Per-edge narrow `useStore` selector** | **Yes** | Each edge derives only its own four numbers, with a custom equality check so it re-renders only when its own rank changes |

Take the third. Cost is O(degree) per edge per frame, which on a 60-edge chain is a few hundred operations. The naive designs are cheaper to write and would have to be thrown away when the main map adopts them, which is the whole reason the interactive canvas is wired first.

---

## Stage 1: extract the geometry

**Mode:** Plan mode
**Touches:** `src/lib/map/edgeAnchors.ts` (new) and its companion `.md`; `src/lib/map/edgeAnchors.test.ts` (new)
**Goal:** One pure, tested module owning face selection and face-fan ordering, consumed by nothing yet.

Pure geometry, no React, no `server-only` import (the module is client-reachable, and `src/lib/map/` already holds server-only modules, so this needs stating in the companion). It may import `Position` from `@xyflow/react`, which is client-safe.

Exports, roughly:
- `pickFace(src, tgt)` returning the source and target `Position` for a node pair.
- `faceRank(edges, nodeId, face)` returning the ordered edge ids on one face of one node, per the sort rule above.
- `anchorPoint(nodeRect, face, index, count)` returning the `{ x, y }` attachment point with pitch and clamping applied.

Shape these so an edge component can call them with only its two endpoint rects plus the set of edges touching those two nodes. Do not design an API that requires the whole graph.

Unit tests are the point of this stage. Cover: face selection at and either side of the `|dx| == |dy|` boundary; ordering stability with ties; the centring formula for `n` of 1, 2, 3 and 5; the pitch clamp kicking in on a high-degree face.

**Done when:** `pnpm test` covers the module, and `pnpm lint` / `pnpm typecheck` pass. Neither canvas imports it yet.

---

## Stage 2: wire the interactive map

**Mode:** Plan mode
**Touches:** `src/components/map/ConnectionEdge.tsx` + `.md`, `src/components/map/MapCanvas.tsx` + `.md`
**Goal:** `ConnectionEdge` derives its anchors from the shared module via a per-edge `useStore` selector. `pickAnchors` and `PARALLEL_STEP_PX` are deleted from the component; `parallelIndex` / `parallelCount` are deleted from `ConnectionEdgeData` and from the `MapCanvas` edge memo (around lines 1810 to 1821).

Plan mode because the selector's equality function and the drag-frame behaviour are the design decisions this whole plan exists to get right. Verify against a real chain, not the test map:

- Drag a node with four or more connections on one face and confirm edges do not re-render across the whole canvas. React DevTools profiler, or a render counter.
- Parallel holes between one pair still separate, now as a consequence of face ordering rather than a special case.
- Selection glow, the `ConnectionDetailPopover` hover target, and the `TravelDot` `animateMotion` path all still track the moved anchors. These ride the same `path`, so they follow for free, but confirm rather than assume.
- Settle the pitch and clamp numbers here and record them in the companion.

**Done when:** the interactive map fans correctly under drag with no measurable re-render regression, `ci-verifier` is green, and the change is committed on its own with a message calling out the visible canvas change.

---

## Stage 3: wire the spectator map

**Mode:** Accept edits
**Touches:** `src/components/public/PublicConnectionEdge.tsx` + `.md`, `src/components/public/SpectatorMap.tsx` + `.md`
**Goal:** The same swap on the read-only canvas. Delete the duplicated `pickAnchors` and `PARALLEL_STEP_PX`, delete `parallelIndex` / `parallelCount` from `PublicConnectionEdgeData` and from the `SpectatorMap` edge memo (lines 58 to 78), consume the shared module through the same selector.

Mechanical against the Stage 2 spec. The spectator canvas has no dragging, so the selector's drag behaviour is untested here by definition; that is fine, it was proven in Stage 2.

Leave the sig tags exactly as they are. They are rewritten in `docs/plans/public-map-spectator-polish.md` Stage 1, which depends on this stage landing first.

**Done when:** `pickAnchors` appears nowhere outside `src/lib/map/edgeAnchors.ts`, the spectator canvas fans identically to the interactive one, and `ci-verifier` is green.
