## edgeAnchors.ts

**Purpose:** Pure geometry for picking a node face and a per-edge attachment point on that face, so several connections leaving one node fan out instead of converging on one pixel.
**File:** `src/lib/map/edgeAnchors.ts`

No `server-only`, React, or DB imports — client-reachable (imported from edge components), unlike most of `src/lib/map/`. Imports only `Position` from `@xyflow/react`.

---

### Types
- `Point = { x: number; y: number }`, `Rect = { x, y, w, h }` — geometry primitives, intentionally local (not in `src/types/index.ts`), same convention as `placement.ts`.
- `IncidentEdge = { id: string; otherCenter: Point }` — an edge touching the node being ranked, reduced to what ordering needs.

### Constants
- `BASE_PITCH_PX = 12` — target spacing between adjacent attachment points on a face.
- `FACE_MARGIN_PX = 8` — corner clearance subtracted from face length before dividing pitch.

---

### center(rect: Rect): Point
The rect's midpoint. Shared by `pickFace`/`faceRank`/`anchorPoint` internally and by `useEdgeAnchors`, which needs it to build incident-edge far-centres from raw node rects.

---

### pickFace(src: Rect, tgt: Rect): { source: Position; target: Position }
Dominant axis of the centre-to-centre delta, oriented so the source side faces the target. `|dx| == |dy|` resolves to the horizontal faces. `target` is always the opposite face of `source`; calling with the endpoints swapped yields the opposite pair, so a rank computed from either endpoint's perspective agrees with this pick.

---

### faceRank(incident: IncidentEdge[], nodeCenter: Point, face: Position): string[]
Filters `incident` to the edges whose far endpoint puts them on `face`, then returns their ids ordered by the perpendicular coordinate of the far endpoint: ascending `y` for `Left`/`Right`, ascending `x` for `Top`/`Bottom`. Ties (two holes to the same neighbour) break by lexicographic `id` comparison, not `localeCompare`, so ordering is identical across locales and across the interactive and spectator canvases. The topmost/leftmost id in the result is the edge heading furthest up/left, which is what lets a reader map a label to a line by rank alone.

**Returns:** Ordered edge ids on that one face of that one node — not the whole graph.

---

### anchorPoint(rect: Rect, face: Position, index: number, count: number): Point
Attachment point for edge `index` of `count` sharing one node face. Pitch is `min(BASE_PITCH_PX, (faceLength - FACE_MARGIN_PX) / (count - 1))` for `count > 1`, so pitch shrinks as degree grows and the fan stays within the face instead of spilling past its corners. Offsets are centred: `(index - (count - 1) / 2) * pitch`.
