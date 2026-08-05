import { faceNormal, type Point } from '@/lib/map/edgeAnchors';
import type { EdgeAnchor } from './useEdgeAnchors';
import { connectionBubbleColor } from './styling';

// Pure visual for a single bubbled end: a gradient wash along the connection
// fading out a short way from the mouth, plus a small circle sitting at the
// mouth itself. Shared verbatim by the app canvas (`ConnectionEdge`) and the
// spectator canvas (`PublicConnectionEdge`) — no hooks, no `data`, no
// interaction.

/** How far the wash reaches, as a fraction of the connection's straight-line length. */
const WASH_FRACTION = 0.2;
/** Absolute cap on wash length, so a long connection doesn't smear the gradient too far. */
const WASH_MAX_PX = 120;
/** How far the bubble circle sits outward from the node face, clear of the tile. */
const BUBBLE_STANDOFF_PX = 10;
const BUBBLE_RADIUS_PX = 6;

export type ConnectionBubbleProps = {
  /** Unique per edge + end (connection ids are digits-only, so this is safe unescaped in `url(#…)`). */
  gradientId: string;
  /** Same `d` the edge's `<BaseEdge>` renders, so the wash tracks its curvature exactly. */
  path: string;
  strokeWidth: number;
  /** This end's own anchor — where the bubble sits and the wash originates. */
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
  const dist = Math.hypot(far.x - anchor.x, far.y - anchor.y);
  const washLength = Math.min(dist * WASH_FRACTION, WASH_MAX_PX);
  const dir = unit(anchor, far);
  const washEnd = { x: anchor.x + dir.x * washLength, y: anchor.y + dir.y * washLength };

  const normal = faceNormal(anchor.position);
  const bubbleCenter = {
    x: anchor.x + normal.x * BUBBLE_STANDOFF_PX,
    y: anchor.y + normal.y * BUBBLE_STANDOFF_PX,
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
          <stop offset="0%" stopColor={color} stopOpacity={0.5} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth={strokeWidth + 8} />
      <circle
        cx={bubbleCenter.x}
        cy={bubbleCenter.y}
        r={BUBBLE_RADIUS_PX}
        fill={color}
        fillOpacity={0.35}
        stroke={color}
        strokeWidth={1.5}
      />
    </g>
  );
}
