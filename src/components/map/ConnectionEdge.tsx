'use client';

import { useEffect, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { MapConnectionEdge } from '@/lib/map/loadMap';
import type { ConnectionEnd } from '@/types';
import { Tooltip } from '@base-ui/react/tooltip';
import { RefreshCw, Shield, type LucideIcon } from 'lucide-react';
import { connectionBadges, connectionStyle } from './styling';
import { useTravelForConnection } from './MapTravelContext';
import { ConnectionDetailPopover } from './ConnectionDetailPopover';
import { useEdgeAnchors } from './useEdgeAnchors';
import { ConnectionBubble } from './ConnectionBubble';
import { ConnectionEndpoint, type ConnectionEndpointState } from './ConnectionEndpoint';

// Selectable connection edge. Scope + mass status drive the stroke colour; EOL
// dashes the line; flags (jump-mass / EOL / frigate / rolling / preserve) render
// as small badges at the midpoint. Hovering the badge cluster opens a detail
// popover. Edits live in the sidebar inspector — clicking the edge merely
// selects it.
//
// Edge endpoints snap to whichever of the four node sides face each other based
// on the dominant axis between the two node centres, so the line exits and
// enters from the sides closest to the other node rather than always running
// bottom-to-top. Several connections leaving the same face fan out to their own
// attachment point instead of converging on one pixel (`useEdgeAnchors`).
//
// Hovering the line reveals a small interactable dot at each end
// (`ConnectionEndpoint`); right-clicking one opens the per-end context menu.
// A flagged end additionally renders a `ConnectionBubble` (a translucent
// circle plus a gradient wash fading out a short way along the line).
//
// The line and the two endpoints are competing right-click targets sharing the
// same patch of canvas, so exactly one of the three is ever emphasised: an
// endpoint under the pointer arms and the line drops its hover weight. Whatever
// is lit is what the click will hit.

export type ConnectionEdgeData = MapConnectionEdge & {
  /** Owning map id — feeds the detail popover's mass-log fetch. */
  mapId: string;
  /** Resolved source-wormhole `universe_wormhole.type_id`; null when no WH sig is attached. */
  wormholeTypeId: number | null;
  /** Resolved source-wormhole code (e.g. "B274"); null when unknown. */
  wormholeCode: string | null;
  /** Right-click on one mouth of this connection; opens the endpoint context menu. */
  onEndpointContextMenu: (connectionId: string, end: ConnectionEnd, clientX: number, clientY: number) => void;
};

export function ConnectionEdge(props: EdgeProps & { data: ConnectionEdgeData }) {
  const {
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props;

  const anchors = useEdgeAnchors(props.id, source, target);

  const pathArgs = {
    sourceX: anchors?.source.x ?? sourceX,
    sourceY: anchors?.source.y ?? sourceY,
    sourcePosition: anchors?.source.position ?? sourcePosition,
    targetX: anchors?.target.x ?? targetX,
    targetY: anchors?.target.y ?? targetY,
    targetPosition: anchors?.target.position ?? targetPosition,
  };
  const sourceAnchor = {
    x: pathArgs.sourceX,
    y: pathArgs.sourceY,
    position: pathArgs.sourcePosition,
    pitch: anchors?.source.pitch ?? 0,
  };
  const targetAnchor = {
    x: pathArgs.targetX,
    y: pathArgs.targetY,
    position: pathArgs.targetPosition,
    pitch: anchors?.target.pitch ?? 0,
  };
  // Gate links render as right-angled (orthogonal) paths to read distinctly from
  // the smooth bezier of wormhole/jumpbridge/abyssal connections; `borderRadius:
  // 0` keeps the corners crisp.
  const [path, labelX, labelY] =
    data.scope === 'stargate'
      ? getSmoothStepPath({ ...pathArgs, borderRadius: 0 })
      : getBezierPath(pathArgs);
  const [hovered, setHovered] = useState(false);
  const [hoveredEnd, setHoveredEnd] = useState<ConnectionEnd | null>(null);

  const style = connectionStyle(data);
  const lineWeight = selected ? 2 : hovered && hoveredEnd === null ? 1.5 : 0;
  const finalStyle = lineWeight
    ? { ...style, strokeWidth: (style.strokeWidth ?? 3) + lineWeight }
    : style;
  const badges = connectionBadges(data);
  const hasLabel = badges.length > 0 || data.isRolling || data.preserveMass;
  const travel = useTravelForConnection(props.id);

  const endpointState = (end: ConnectionEnd): ConnectionEndpointState =>
    hoveredEnd === end ? 'armed' : hovered ? 'revealed' : 'idle';

  const onEndpointHover = (end: ConnectionEnd, isHovered: boolean) =>
    setHoveredEnd((current) => (isHovered ? end : current === end ? null : current));

  return (
    <>
      <g
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
          setHoveredEnd(null);
        }}
      >
        {data.sourceBubbled && (
          <ConnectionBubble
            gradientId={`bubble-${props.id}-source`}
            path={path}
            strokeWidth={finalStyle.strokeWidth ?? 3}
            anchor={sourceAnchor}
            far={targetAnchor}
          />
        )}
        {data.targetBubbled && (
          <ConnectionBubble
            gradientId={`bubble-${props.id}-target`}
            path={path}
            strokeWidth={finalStyle.strokeWidth ?? 3}
            anchor={targetAnchor}
            far={sourceAnchor}
          />
        )}
        <BaseEdge path={path} style={finalStyle} />
        <ConnectionEndpoint
          end="source"
          anchor={sourceAnchor}
          state={endpointState('source')}
          bubbled={data.sourceBubbled}
          onHoverChange={onEndpointHover}
          onContextMenu={(end, clientX, clientY) => data.onEndpointContextMenu(props.id, end, clientX, clientY)}
        />
        <ConnectionEndpoint
          end="target"
          anchor={targetAnchor}
          state={endpointState('target')}
          bubbled={data.targetBubbled}
          onHoverChange={onEndpointHover}
          onContextMenu={(end, clientX, clientY) => data.onEndpointContextMenu(props.id, end, clientX, clientY)}
        />
      </g>
      {travel && (
        <TravelDot
          key={travel.token}
          path={path}
          direction={travel.direction}
          color={style.stroke}
        />
      )}
      {hasLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex flex-col items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {(data.isRolling || data.preserveMass) && (
              <div className="flex items-center gap-1">
                {data.isRolling && (
                  <DoNotJumpFlag
                    icon={RefreshCw}
                    label="ROLLING — do not jump this hole. Its mass is being deliberately collapsed."
                  />
                )}
                {data.preserveMass && (
                  <DoNotJumpFlag
                    icon={Shield}
                    label="PRESERVE MASS — do not jump this hole unless absolutely necessary; every pass shortens its life."
                  />
                )}
              </div>
            )}
            {badges.length > 0 && (
              <ConnectionDetailPopover
                connection={data}
                mapId={data.mapId}
                wormholeTypeId={data.wormholeTypeId}
                wormholeCode={data.wormholeCode}
              >
                {badges.map((b) =>
                  b.tone === 'danger' ? (
                    <span
                      key={b.key}
                      className="rounded-sm bg-red-600 px-1 py-px font-bold text-white"
                      aria-label="Expired connection — do not jump"
                    >
                      {b.label}
                    </span>
                  ) : b.tone === 'warn' ? (
                    <span
                      key={b.key}
                      className="rounded-sm bg-amber-400 px-1 py-px font-bold text-black"
                      aria-label="Small connection — frigate-size ships only"
                    >
                      {b.label}
                    </span>
                  ) : (
                    <span key={b.key} style={{ color: style.stroke }}>
                      {b.label}
                    </span>
                  ),
                )}
              </ConnectionDetailPopover>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// A loud "do not jump" flag stacked above the connection label. Rolling and
// preserve-mass both mean the same thing to a pilot at the keyboard — keep your
// ship out of this hole — so both render as a large red glyph in a filled red
// badge with an explanatory tooltip. `pointer-events-auto` re-enables hover on
// the icon (the label wrapper is `pointer-events-none` so clicks hit the path);
// `nodrag nopan` stops the interaction from dragging the canvas.
function DoNotJumpFlag({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        className="nodrag nopan pointer-events-auto inline-flex items-center justify-center rounded-full bg-red-600 p-1 shadow-md ring-2 ring-red-300/40"
      >
        <Icon className="size-5 text-white" strokeWidth={2.75} aria-hidden />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 max-w-[220px] rounded-md border border-red-500/40 bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// A faint dot that glides once along the connection curve in the travel
// direction when a tracked pilot jumps across it. Mounted (and remounted via
// `key={token}`) per jump.
//
// The SMIL `<animateMotion>` is kicked imperatively with `beginElement()` on
// mount instead of relying on the default `begin="0s"`: a begin offset is
// resolved against the SVG document timeline (page load), so on a long-lived
// canvas "0s" is already in the past by the time a jump happens and the browser
// renders the animation as already-finished — the dot would snap to the curve's
// end and never move. `begin="indefinite"` + `beginElement()` starts it at the
// current document time so it actually plays. animateMotion runs source→target
// by default; reverse traverses the path backwards via `keyPoints`.
function TravelDot({
  path,
  direction,
  color,
}: {
  path: string;
  direction: 'forward' | 'reverse';
  color?: string;
}) {
  const motionRef = useRef<SVGAnimateMotionElement>(null);
  useEffect(() => {
    motionRef.current?.beginElement();
  }, []);
  return (
    <circle r={5} fill={color} opacity={0.55}>
      <animateMotion
        ref={motionRef}
        begin="indefinite"
        dur="1.2s"
        path={path}
        fill="freeze"
        {...(direction === 'reverse'
          ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' as const }
          : {})}
      />
    </circle>
  );
}

