import { faceNormal } from '@/lib/map/edgeAnchors';
import type { EdgeAnchor } from './useEdgeAnchors';
import type { ConnectionEnd } from '@/types';
import { connectionEndpointColor } from './styling';
import { useMarkScale } from './useMarkScale';

// The interactable element at one mouth of a connection: app canvas only,
// invisible until hovered. Kept separate from `ConnectionBubble` (the purely
// visual marker) so issue #124 can grow this into a drag handle for overriding
// face placement without touching the bubble's rendering.
//
// Its dot is deliberately a neutral grey rather than the bubble hue: this is
// the handle, not the state, and the two must not be mistaken for each other
// when a bubbled end is hovered.

const HIT_RADIUS_PX = 11;
const DOT_RADIUS_PX = 3;
/** Held clear of the node tile, which would otherwise swallow the hit circle's pointer events. */
const STANDOFF_PX = 13;

export type ConnectionEndpointProps = {
  end: ConnectionEnd;
  anchor: EdgeAnchor;
  visible: boolean;
  onContextMenu: (end: ConnectionEnd, clientX: number, clientY: number) => void;
};

export function ConnectionEndpoint({ end, anchor, visible, onContextMenu }: ConnectionEndpointProps) {
  const scale = useMarkScale();
  const normal = faceNormal(anchor.position);
  const cx = anchor.x + normal.x * STANDOFF_PX * scale;
  const cy = anchor.y + normal.y * STANDOFF_PX * scale;

  return (
    <g
      className="nodrag nopan"
      style={{ cursor: 'pointer' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(end, e.clientX, e.clientY);
      }}
    >
      <circle cx={cx} cy={cy} r={HIT_RADIUS_PX * scale} fill="transparent" style={{ pointerEvents: 'all' }} />
      {visible && (
        <circle
          cx={cx}
          cy={cy}
          r={DOT_RADIUS_PX * scale}
          fill={connectionEndpointColor()}
          fillOpacity={0.7}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}
