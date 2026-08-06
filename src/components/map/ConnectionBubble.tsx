'use client';

import { faceNormal, type Point } from '@/lib/map/edgeAnchors';
import type { EdgeAnchor } from './useEdgeAnchors';
import { connectionBubbleColor } from './styling';
import { useMarkScale } from './useMarkScale';

// Pure visual for a single bubbled end: a ring straddling the connection at the
// mouth, plus a gradient wash running from that mouth a short way along the
// line. Shared by the app canvas (`ConnectionEdge`) and the spectator canvas
// (`PublicConnectionEdge`) — no `data`, no interaction.
//
// The ring is centred on the line rather than set beside it, and is drawn
// before the edge stroke, so the connection visibly enters and leaves it: a
// bubble is a volume you cross when you jump the hole, not a property hanging
// off it. An open ring also holds its contrast at small sizes far better than a
// translucent disc.
//
// It sits on the mouth itself and lets the node tile (which the edges layer
// paints under) clip its inner arc. Standing it off far enough to clear the
// tile detaches it from the mouth wherever the bezier turns sharply, since the
// standoff follows the face normal while the line leaves at its own angle.

/** How far the wash reaches, as a fraction of the connection's straight-line length. */
const WASH_FRACTION = 0.4;
/** Absolute cap on wash length, so a long connection doesn't smear the gradient too far. */
const WASH_MAX_PX = 220;
/** Floor on wash length, so two adjacent systems still get a readable run of gradient. */
const WASH_MIN_PX = 90;
/** How far the wash overflows the connection stroke on each side — the fringe either side of the line is all of it that shows. */
const WASH_SPREAD_PX = 3;
/** How far the ring's centre sits outward from the node face. Small enough that the node tile clips the ring's inner arc. */
const RING_STANDOFF_PX = 3;
const RING_RADIUS_PX = 7.5;
const RING_STROKE_PX = 2;

export type ConnectionBubbleProps = {
  /** Unique per edge + end (connection ids are digits-only, so this is safe unescaped in `url(#…)`). */
  gradientId: string;
  /** Same `d` the edge's `<BaseEdge>` renders, so the wash tracks its curvature exactly. */
  path: string;
  strokeWidth: number;
  /** This end's own anchor — where the ring sits and the wash originates. */
  anchor: EdgeAnchor;
  /** The connection's other end — the wash fades toward it. */
  far: EdgeAnchor;
};

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  return dist === 0 ? { x: 0, y: 0 } : { x: dx / dist, y: dy / dist };
}

export function ConnectionBubble({ gradientId, path, strokeWidth, anchor, far }: ConnectionBubbleProps) {
  const color = connectionBubbleColor();
  const scale = useMarkScale();

  const dist = Math.hypot(far.x - anchor.x, far.y - anchor.y);
  // The floor yields to half the connection rather than overriding it, so a wash
  // never reaches the far end and reads as staining the whole line.
  const washLength = Math.min(
    Math.max(dist * WASH_FRACTION, Math.min(WASH_MIN_PX, dist * 0.45)),
    WASH_MAX_PX,
  );
  const dir = unit(anchor, far);
  const washEnd = { x: anchor.x + dir.x * washLength, y: anchor.y + dir.y * washLength };

  const normal = faceNormal(anchor.position);
  const standoff = RING_STANDOFF_PX * scale;
  const ringCenter = {
    x: anchor.x + normal.x * standoff,
    y: anchor.y + normal.y * standoff,
  };

  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={anchor.x}
          y1={anchor.y}
          x2={washEnd.x}
          y2={washEnd.y}
          spreadMethod="pad"
        >
          {/* Held near full strength through the first stretch before falling
              away — a straight ramp to zero spends most of its length too faint
              to register. */}
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="45%" stopColor={color} stopOpacity={0.5} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth + WASH_SPREAD_PX * 2 * scale}
      />
      <circle
        cx={ringCenter.x}
        cy={ringCenter.y}
        r={RING_RADIUS_PX * scale}
        fill={color}
        fillOpacity={0.13}
        stroke={color}
        strokeWidth={RING_STROKE_PX * scale}
      />
    </g>
  );
}
