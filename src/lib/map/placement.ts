// Pure geometry for non-overlapping, grid-aligned node placement. No server-only,
// React, or DB imports — this runs in jobs, server actions, and the browser, and is
// unit-testable in isolation.

/** Snap granularity for all placement. */
export const GRID_SIZE = 10;
/** Collision footprint of a system node: `min-w-36`≈144px plus the optional statics line and a margin. */
export const NODE_WIDTH = 145;
export const NODE_HEIGHT = 45;
/** Minimum empty space kept between two node footprints. */
export const PLACEMENT_GAP = 20;
/**
 * Half-extent of a node's exclusion zone, rounded up to a whole grid cell so every
 * candidate stays grid-aligned (145+20=165→170, 45+20=65→70). The footprint+gap is the
 * floor; rounding up only ever widens the gap, never overlaps.
 */
export const SLOT_X = Math.ceil((NODE_WIDTH + PLACEMENT_GAP) / GRID_SIZE) * GRID_SIZE; // 170
export const SLOT_Y = Math.ceil((NODE_HEIGHT + PLACEMENT_GAP) / GRID_SIZE) * GRID_SIZE; // 70

export type Point = { x: number; y: number };
/** A placed node's top-left corner; width/height are implied by the constants above. */
export type Rect = Point;

export function snapToGrid(p: Point): Point {
  return {
    x: Math.round(p.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(p.y / GRID_SIZE) * GRID_SIZE,
  };
}

/** True when two top-left points sit closer than one footprint+gap on both axes. */
export function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < SLOT_X && Math.abs(a.y - b.y) < SLOT_Y;
}

function isOpen(candidate: Point, occupied: Point[]): boolean {
  return !occupied.some((o) => overlaps(candidate, o));
}

/** Nearest to `base` first; ties prefer larger x then larger y (below/right). */
function byNearest(base: Point) {
  return (a: Point, b: Point): number => {
    const da = (a.x - base.x) ** 2 + (a.y - base.y) ** 2;
    const db = (b.x - base.x) ** 2 + (b.y - base.y) ** 2;
    if (da !== db) return da - db;
    if (a.x !== b.x) return b.x - a.x;
    return b.y - a.y;
  };
}

/**
 * Snap `anchor`; if that slot is clear, return it. Otherwise return the grid-aligned
 * point closest to it that overlaps nothing in `occupied` — the minimal nudge out of
 * the collision, in whatever direction is actually nearest.
 *
 * The free space is the plane minus one exclusion rectangle (half-extent
 * `SLOT_X`×`SLOT_Y`) per occupied node. The nearest free point to `base` either keeps a
 * coordinate at `base` (sliding straight off one edge) or pins it to a blocker's edge
 * (`o.x ± SLOT_X` / `o.y ± SLOT_Y`); cross-blocker corners fall out of the product of
 * those candidate coordinates. So the true nearest open slot lives in `xs × ys`, which
 * we scan directly. The candidate beyond the rightmost blocker is always open, so a
 * result always exists. Ties prefer below/right so growth reads naturally.
 */
export function findOpenPosition(anchor: Point, occupied: Point[]): Point {
  const base = snapToGrid(anchor);
  if (isOpen(base, occupied)) return base;

  // Edges (and SLOT steps) are grid-multiples and `base` is snapped, so every candidate
  // coordinate stays grid-aligned without re-snapping.
  const xs = new Set<number>([base.x]);
  const ys = new Set<number>([base.y]);
  for (const o of occupied) {
    xs.add(o.x + SLOT_X);
    xs.add(o.x - SLOT_X);
    ys.add(o.y + SLOT_Y);
    ys.add(o.y - SLOT_Y);
  }

  const nearer = byNearest(base);
  let best: Point | null = null;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = { x, y };
      if (!isOpen(candidate, occupied)) continue;
      if (best === null || nearer(candidate, best) < 0) best = candidate;
    }
  }

  return best ?? base;
}
