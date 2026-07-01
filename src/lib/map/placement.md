## placement.ts

**Purpose:** Pure, framework-free geometry for placing map nodes on a snapped grid without overlapping existing ones; shared by server jobs, server actions, and the client map.
**File:** `src/lib/map/placement.ts`

No `server-only`, React, or DB imports — runs anywhere and is unit-testable in isolation.

---

### Constants
- `GRID_SIZE = 10` — snap granularity.
- `NODE_WIDTH = 145`, `NODE_HEIGHT = 45` — collision footprint of a system node.
- `PLACEMENT_GAP = 20` — minimum empty space between footprints.
- `SLOT_X = 170`, `SLOT_Y = 70` — half-extent of a node's exclusion zone, the `NODE_*` + gap footprint rounded up to a whole grid cell so candidates stay grid-aligned.

### Types
- `Point = { x: number; y: number }` — top-left coordinate.
- `Rect = Point` — alias; width/height implied by the constants.

These are geometry primitives, not domain types — intentionally local to this module (not in `src/types/index.ts`).

---

### snapToGrid(p: Point): Point
Rounds `p` to the nearest `GRID_SIZE` on both axes.

---

### overlaps(a: Point, b: Point): boolean
True when two top-left points sit closer than `SLOT_X`/`SLOT_Y` on both axes (footprint + gap collision).

---

### findOpenPosition(anchor: Point, occupied: Point[]): Point
Snaps `anchor`; if that slot is clear, returns it. Otherwise returns the **exact nearest** grid-aligned point that overlaps nothing in `occupied` — the minimal nudge out of the collision, in whatever direction is actually closest (no fixed bias, no big spiral leap).

Treats the free space as the plane minus one exclusion rectangle (half-extent `SLOT_X`×`SLOT_Y`) per occupied node. The nearest free point's coordinates are provably constrained to `xs × ys` where `xs = {anchor.x} ∪ {o.x ± SLOT_X}` and `ys = {anchor.y} ∪ {o.y ± SLOT_Y}` over all blockers — each axis either stays at the drop (sliding straight off an edge) or pins to a blocker's edge, and cross-blocker corners fall out of the product. It scans that small set and keeps the nearest open one. The point beyond the rightmost blocker is always open, so a result always exists. Ties prefer below/right so growth reads naturally.

**Parameters:**
- `anchor` — desired location (e.g. a parent system's position, the viewport centre, or a drag drop point).
- `occupied` — top-left points of all currently-placed nodes.

**Returns:** The grid-aligned `Point` nearest `anchor` that does not `overlaps` any member of `occupied`.

Generalises the ad-hoc fan layout in `thera.ts` (`hubBasePosition` + the fan loop); Thera's `HUB_GROUP_SPACING`/`TARGET_FAN_RADIUS` could optionally re-point at these constants later.
