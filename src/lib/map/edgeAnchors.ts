import { Position } from '@xyflow/react';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** An edge touching the node being ranked, reduced to what ordering needs. */
export type IncidentEdge = { id: string; otherCenter: Point };

export const BASE_PITCH_PX = 12;
export const FACE_MARGIN_PX = 8;

export function center(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// The near node's face for a delta pointing from `from` to `to`. Horizontal
// wins the |dx| == |dy| tie, and the function is antisymmetric under that
// tie-break (swapping from/to always yields the opposite face), which is what
// keeps a rank computed from either endpoint agree with `pickFace`.
function faceOf(from: Point, to: Point): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }
  return dy >= 0 ? Position.Bottom : Position.Top;
}

/** Unit vector pointing away from the node across the given face. */
export function faceNormal(face: Position): Point {
  switch (face) {
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Top:
      return { x: 0, y: -1 };
  }
}

function opposite(face: Position): Position {
  switch (face) {
    case Position.Right:
      return Position.Left;
    case Position.Left:
      return Position.Right;
    case Position.Bottom:
      return Position.Top;
    case Position.Top:
      return Position.Bottom;
  }
}

/** Dominant-axis face pair for a node pair, oriented so the source side faces the target. */
export function pickFace(src: Rect, tgt: Rect): { source: Position; target: Position } {
  const source = faceOf(center(src), center(tgt));
  return { source, target: opposite(source) };
}

/**
 * Orders the edges attached to one face of one node so the topmost/leftmost
 * attachment point belongs to the edge heading furthest up/left. Ties (two
 * holes to the same neighbour) break by edge id so ordering is stable across
 * renders and identical across both canvases.
 */
export function faceRank(incident: IncidentEdge[], nodeCenter: Point, face: Position): string[] {
  const onFace = incident.filter((e) => faceOf(nodeCenter, e.otherCenter) === face);
  // Departure angle, not the far endpoint's raw perpendicular coordinate: a
  // distant neighbour can sit further up while heading at a shallower angle
  // than a near one, and ordering it by position alone crosses the two lines
  // right at the face. Face selection guarantees |along| >= |perp|, so the
  // ratio stays in [-1, 1] and is monotonic in angle across the whole face.
  const slopeKey = (e: IncidentEdge) => {
    const dx = e.otherCenter.x - nodeCenter.x;
    const dy = e.otherCenter.y - nodeCenter.y;
    const [perp, along] =
      face === Position.Left || face === Position.Right
        ? [dy, Math.abs(dx)]
        : [dx, Math.abs(dy)];
    return along === 0 ? 0 : perp / along;
  };
  return onFace
    .slice()
    .sort((a, b) => {
      const ka = slopeKey(a);
      const kb = slopeKey(b);
      if (ka !== kb) return ka - kb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((e) => e.id);
}

/**
 * Spacing between adjacent attachment points on one node face carrying
 * `count` edges. Shrinks below `BASE_PITCH_PX` as degree grows so the fan
 * never spills past the face's corners. `0` for `count <= 1` — unconstrained,
 * no neighbour to collide with.
 */
export function facePitch(rect: Rect, face: Position, count: number): number {
  if (count <= 1) return 0;
  const faceLength = face === Position.Left || face === Position.Right ? rect.h : rect.w;
  return Math.min(BASE_PITCH_PX, (faceLength - FACE_MARGIN_PX) / (count - 1));
}

/** Attachment point for index `index` of `count` edges sharing one node face. */
export function anchorPoint(rect: Rect, face: Position, index: number, count: number): Point {
  const pitch = facePitch(rect, face, count);
  const offset = (index - (count - 1) / 2) * pitch;
  const { x: cx, y: cy } = center(rect);

  switch (face) {
    case Position.Right:
      return { x: rect.x + rect.w, y: cy + offset };
    case Position.Left:
      return { x: rect.x, y: cy + offset };
    case Position.Bottom:
      return { x: cx + offset, y: rect.y + rect.h };
    case Position.Top:
      return { x: cx + offset, y: rect.y };
  }
}
