import { Position } from '@xyflow/react';
import { faceNormal } from '@/lib/map/edgeAnchors';
import type { EdgeAnchor } from './useEdgeAnchors';
import type { ConnectionEnd } from '@/types';
import { connectionEndpointColor } from './styling';
import { useMarkScale } from './useMarkScale';

// The interactable element at one mouth of a connection: app canvas only,
// invisible until the edge is hovered. Kept separate from `ConnectionBubble`
// (the purely visual marker) so issue #124 can grow this into a drag handle for
// overriding face placement without touching the bubble's rendering.
//
// Its marks are deliberately a neutral grey rather than the bubble hue: this is
// the handle, not the state, and the two must not be mistaken for each other
// when a bubbled end is hovered.
//
// The armed halo is drawn at exactly the hit target's boundary. The dot alone
// understates its own target by an order of magnitude in area, so the only
// reliable way to know which end a right-click will land on is to see the
// boundary of the one currently under the pointer.
//
// The hit target is a face-oriented slot, not a plain circle: neighbours on a
// crowded face separate only *along* the face, so its along-face half-extent
// is capped at half the fan's pitch while its cross-face half-extent (the
// reach outward from the mouth, where the pointer arrives from) stays at the
// full radius. That keeps adjacent endpoints' targets disjoint without
// shrinking the direction that has room to spare.

const HIT_RADIUS_PX = 11;
const DOT_RADIUS_PX = 3;
const HALO_STROKE_PX = 1.5;
/** Held clear of the node tile, which would otherwise swallow the hit target's pointer events. */
const STANDOFF_PX = 10;

/** `idle` is inert: no mark, and no hit target to right-click by accident. */
export type ConnectionEndpointState = 'idle' | 'revealed' | 'armed';

export type ConnectionEndpointProps = {
  end: ConnectionEnd;
  anchor: EdgeAnchor;
  state: ConnectionEndpointState;
  /** Suppresses the revealed dot: this mouth already carries the bubble's ring. */
  bubbled: boolean;
  onHoverChange: (end: ConnectionEnd, hovered: boolean) => void;
  onContextMenu: (end: ConnectionEnd, clientX: number, clientY: number) => void;
};

export function ConnectionEndpoint({
  end,
  anchor,
  state,
  bubbled,
  onHoverChange,
  onContextMenu,
}: ConnectionEndpointProps) {
  const scale = useMarkScale();
  const normal = faceNormal(anchor.position);
  const cx = anchor.x + normal.x * STANDOFF_PX * scale;
  const cy = anchor.y + normal.y * STANDOFF_PX * scale;
  const color = connectionEndpointColor();

  // Clamped against the raw (unscaled) pitch, after the radius has already
  // been scaled: the mark holds a constant screen size and so grows in flow
  // space as the canvas zooms out, whereas the fan's pitch is fixed in flow
  // space and must not grow with it.
  const radius = HIT_RADIUS_PX * scale;
  const alongHalf = anchor.pitch > 0 ? Math.min(radius, anchor.pitch / 2) : radius;
  const vertical = anchor.position === Position.Left || anchor.position === Position.Right;
  const halfW = vertical ? radius : alongHalf;
  const halfH = vertical ? alongHalf : radius;
  const slotCorner = Math.min(halfW, halfH);

  return (
    <g
      className="nodrag nopan"
      style={{ cursor: state === 'idle' ? undefined : 'pointer' }}
      onMouseEnter={() => onHoverChange(end, true)}
      onMouseLeave={() => onHoverChange(end, false)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(end, e.clientX, e.clientY);
      }}
    >
      <rect
        x={cx - halfW}
        y={cy - halfH}
        width={halfW * 2}
        height={halfH * 2}
        rx={slotCorner}
        ry={slotCorner}
        fill="transparent"
        style={{ pointerEvents: state === 'idle' ? 'none' : 'all' }}
      />
      {state === 'armed' && (
        <rect
          x={cx - halfW}
          y={cy - halfH}
          width={halfW * 2}
          height={halfH * 2}
          rx={slotCorner}
          ry={slotCorner}
          fill={color}
          fillOpacity={0.16}
          stroke={color}
          strokeOpacity={0.85}
          strokeWidth={HALO_STROKE_PX * scale}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {(state === 'armed' || (state === 'revealed' && !bubbled)) && (
        <circle
          cx={cx}
          cy={cy}
          r={DOT_RADIUS_PX * scale}
          fill={color}
          fillOpacity={state === 'armed' ? 1 : 0.7}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}
