import { faceNormal } from '@/lib/map/edgeAnchors';
import type { EdgeAnchor } from './useEdgeAnchors';
import type { ConnectionEnd } from '@/types';

// The interactable element at one mouth of a connection: app canvas only,
// invisible until hovered. Kept separate from `ConnectionBubble` (the purely
// visual marker) so issue #124 can grow this into a drag handle for overriding
// face placement without touching the bubble's rendering.

const HIT_RADIUS_PX = 11;
const DOT_RADIUS_PX = 3;
/** Same standoff `ConnectionBubble` uses, so the dot and a set bubble land on the same spot. */
const STANDOFF_PX = 10;

export type ConnectionEndpointProps = {
  end: ConnectionEnd;
  anchor: EdgeAnchor;
  visible: boolean;
  color: string;
  onContextMenu: (end: ConnectionEnd, clientX: number, clientY: number) => void;
};

export function ConnectionEndpoint({ end, anchor, visible, color, onContextMenu }: ConnectionEndpointProps) {
  const normal = faceNormal(anchor.position);
  const cx = anchor.x + normal.x * STANDOFF_PX;
  const cy = anchor.y + normal.y * STANDOFF_PX;

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
      <circle cx={cx} cy={cy} r={HIT_RADIUS_PX} fill="transparent" style={{ pointerEvents: 'all' }} />
      {visible && <circle cx={cx} cy={cy} r={DOT_RADIUS_PX} fill={color} fillOpacity={0.7} style={{ pointerEvents: 'none' }} />}
    </g>
  );
}
