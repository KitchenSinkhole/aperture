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
// The armed halo is drawn at exactly the hit radius. The dot alone understates
// its own target by an order of magnitude in area, and a fanned face packs
// neighbouring endpoints closer together than that target is wide, so the only
// reliable way to know which end a right-click will land on is to see the
// boundary of the one currently under the pointer.

const HIT_RADIUS_PX = 11;
const DOT_RADIUS_PX = 3;
const HALO_STROKE_PX = 1.5;
/** Held clear of the node tile, which would otherwise swallow the hit circle's pointer events. */
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
      <circle
        cx={cx}
        cy={cy}
        r={HIT_RADIUS_PX * scale}
        fill="transparent"
        style={{ pointerEvents: state === 'idle' ? 'none' : 'all' }}
      />
      {state === 'armed' && (
        <circle
          cx={cx}
          cy={cy}
          r={HIT_RADIUS_PX * scale}
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
