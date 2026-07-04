'use client';

import { useEffect, useRef } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import type { MapConnectionEdge } from '@/lib/map/loadMap';
import { Tooltip } from '@base-ui/react/tooltip';
import { RefreshCw, Shield, type LucideIcon } from 'lucide-react';
import { connectionBadges, connectionStyle } from './styling';
import { useTravelForConnection } from './MapTravelContext';
import { ConnectionDetailPopover } from './ConnectionDetailPopover';

// Selectable connection edge. Scope + mass status drive the stroke colour; EOL
// dashes the line; flags (jump-mass / EOL / frigate / rolling / preserve) render
// as small badges at the midpoint. Hovering the badge cluster opens a detail
// popover. Edits live in the sidebar inspector — clicking the edge merely
// selects it.
//
// Edge endpoints snap to whichever of the four node sides face each other based
// on the dominant axis between the two node centres, so the line exits and
// enters from the sides closest to the other node rather than always running
// bottom-to-top.

export type ConnectionEdgeData = MapConnectionEdge & {
  /** 0-based index of this edge among all parallel edges between the same node pair. */
  parallelIndex: number;
  /** Total number of edges between this node pair (1 = only edge, no offset applied). */
  parallelCount: number;
  /** Owning map id — feeds the detail popover's mass-log fetch. */
  mapId: string;
  /** Resolved source-wormhole `universe_wormhole.type_id`; null when no WH sig is attached. */
  wormholeTypeId: number | null;
  /** Resolved source-wormhole code (e.g. "B274"); null when unknown. */
  wormholeCode: string | null;
};

const PARALLEL_STEP_PX = 12;

type Anchor = { x: number; y: number; position: Position };

// `offset` shifts the anchor along the node face perpendicular to the
// dominant axis, so parallel edges between the same pair fan out visibly.
function pickAnchors(
  src: { x: number; y: number; w: number; h: number },
  tgt: { x: number; y: number; w: number; h: number },
  offset = 0,
): { source: Anchor; target: Anchor } {
  const sCx = src.x + src.w / 2;
  const sCy = src.y + src.h / 2;
  const tCx = tgt.x + tgt.w / 2;
  const tCy = tgt.y + tgt.h / 2;
  const dx = tCx - sCx;
  const dy = tCy - sCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      return {
        source: { x: src.x + src.w, y: sCy + offset, position: Position.Right },
        target: { x: tgt.x, y: tCy + offset, position: Position.Left },
      };
    }
    return {
      source: { x: src.x, y: sCy + offset, position: Position.Left },
      target: { x: tgt.x + tgt.w, y: tCy + offset, position: Position.Right },
    };
  }
  if (dy >= 0) {
    return {
      source: { x: sCx + offset, y: src.y + src.h, position: Position.Bottom },
      target: { x: tCx + offset, y: tgt.y, position: Position.Top },
    };
  }
  return {
    source: { x: sCx + offset, y: src.y, position: Position.Top },
    target: { x: tCx + offset, y: tgt.y + tgt.h, position: Position.Bottom },
  };
}

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

  const { parallelIndex, parallelCount } = data;
  const offset =
    parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * PARALLEL_STEP_PX : 0;

  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sPos = sourceNode?.internals.positionAbsolute;
  const tPos = targetNode?.internals.positionAbsolute;
  const sW = sourceNode?.measured.width;
  const sH = sourceNode?.measured.height;
  const tW = targetNode?.measured.width;
  const tH = targetNode?.measured.height;

  const anchors =
    sPos && tPos && sW && sH && tW && tH
      ? pickAnchors(
        { x: sPos.x, y: sPos.y, w: sW, h: sH },
        { x: tPos.x, y: tPos.y, w: tW, h: tH },
        offset,
      )
      : null;

  const pathArgs = {
    sourceX: anchors?.source.x ?? sourceX,
    sourceY: anchors?.source.y ?? sourceY,
    sourcePosition: anchors?.source.position ?? sourcePosition,
    targetX: anchors?.target.x ?? targetX,
    targetY: anchors?.target.y ?? targetY,
    targetPosition: anchors?.target.position ?? targetPosition,
  };
  // Gate links render as right-angled (orthogonal) paths to read distinctly from
  // the smooth bezier of wormhole/jumpbridge/abyssal connections; `borderRadius:
  // 0` keeps the corners crisp.
  const [path, labelX, labelY] =
    data.scope === 'stargate'
      ? getSmoothStepPath({ ...pathArgs, borderRadius: 0 })
      : getBezierPath(pathArgs);
  const style = connectionStyle(data);
  const finalStyle = selected ? { ...style, strokeWidth: (style.strokeWidth ?? 3) + 2 } : style;
  const badges = connectionBadges(data);
  const hasLabel = badges.length > 0 || data.isRolling || data.preserveMass;
  const travel = useTravelForConnection(props.id);

  return (
    <>
      <BaseEdge path={path} style={finalStyle} />
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
                  b.warn ? (
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

