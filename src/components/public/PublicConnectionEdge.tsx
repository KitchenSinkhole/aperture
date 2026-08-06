'use client';

import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { Tooltip } from '@base-ui/react/tooltip';
import { RefreshCw, Shield, type LucideIcon } from 'lucide-react';
import { connectionBadges, connectionStyle, systemClassColor } from '@/components/map/styling';
import { ConnectionBubble } from '@/components/map/ConnectionBubble';
import { useEdgeAnchors, type EdgeAnchor } from '@/components/map/useEdgeAnchors';
import type { PublicMapConnectionEdge } from '@/types';

// Spectator connection edge. Scope + mass status drive the stroke colour, EOL
// dashes the line, and flags render as badges at the midpoint — the same
// language as the app's `ConnectionEdge`, minus selection, travel animation and
// the session-gated detail popover.
//
// Hovering a wormhole reveals the sig code at each end, placed against its own
// endpoint node: the two mouths of one hole carry different codes, and knowing
// which to look for in which system is the whole point.
//
// A bubbled end renders the same `ConnectionBubble` the app canvas draws, with
// no endpoint dot and no hit target: a spectator cannot set or clear the flag.

export type PublicConnectionEdgeData = PublicMapConnectionEdge & {
  /** `universe_system.security` at each end, for tinting that end's sig tag with the far system's class. */
  endpointSecurity: { source: string | null; target: string | null };
  /** This hole is on the lit route: the stroke thickens and both sig tags show without a pointer. */
  highlighted: boolean;
  /** Publishes this edge's hover so both endpoint tiles can ring alongside the tags. */
  onHoverChange: (connectionId: string | null) => void;
};

/** Extra stroke width a lit connection gains, so a route reads as one thread. */
const HIGHLIGHT_STROKE_BOOST_PX = 2;

/** Nominal sig-tag box. Not measured — a fixed-size mono code at this font size. */
const SIG_TAG_W_PX = 34;
const SIG_TAG_H_PX = 18;
/** How far a tag laps onto its tile, so it reads as a tab clipped to the face. */
const SIG_TAG_OVERLAP_PX = 3;
/** Breathing room between the two tags when a short gap forces perpendicular relief. */
const SIG_TAG_RELIEF_GAP_PX = 4;

/**
 * Places a tag flush against its own endpoint's fanned attachment point,
 * lapping onto the tile. Adjacency carries attribution, not distance, so this
 * holds at any hole length. When the gap is too short for both tags to clear
 * each other head-on, they shift apart perpendicular to the face — safe here
 * because each tag still touches its own node, so adjacency outranks the split.
 */
function tagPosition(anchor: EdgeAnchor, other: EdgeAnchor, sign: 1 | -1): { x: number; y: number } {
  const horizontal = anchor.position === Position.Left || anchor.position === Position.Right;
  const approach = horizontal ? SIG_TAG_W_PX : SIG_TAG_H_PX;
  const separate = horizontal ? SIG_TAG_H_PX : SIG_TAG_W_PX;
  const gap = Math.hypot(other.x - anchor.x, other.y - anchor.y);
  const tight = gap < 2 * approach - 2 * SIG_TAG_OVERLAP_PX;
  const shift = tight ? (sign * (separate + SIG_TAG_RELIEF_GAP_PX)) / 2 : 0;

  switch (anchor.position) {
    case Position.Right:
      return { x: anchor.x - SIG_TAG_OVERLAP_PX, y: anchor.y + shift };
    case Position.Left:
      return { x: anchor.x + SIG_TAG_OVERLAP_PX, y: anchor.y + shift };
    case Position.Bottom:
      return { x: anchor.x + shift, y: anchor.y - SIG_TAG_OVERLAP_PX };
    case Position.Top:
      return { x: anchor.x + shift, y: anchor.y + SIG_TAG_OVERLAP_PX };
  }
}

/** Anchors a tag's own edge, rather than its center, to the face it laps onto. */
function tagTransformOrigin(position: Position): string {
  switch (position) {
    case Position.Right:
      return 'translate(0, -50%)';
    case Position.Left:
      return 'translate(-100%, -50%)';
    case Position.Bottom:
      return 'translate(-50%, 0)';
    case Position.Top:
      return 'translate(-50%, -100%)';
  }
}

export function PublicConnectionEdge(props: EdgeProps & { data: PublicConnectionEdgeData }) {
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
  } = props;

  const [hovered, setHovered] = useState(false);
  const setHoverState = (next: boolean) => {
    setHovered(next);
    data.onHoverChange(next ? props.id : null);
  };

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
  // Gate links render as right-angled paths to read distinctly from the smooth
  // bezier of wormhole/jumpbridge/abyssal connections.
  const [path, labelX, labelY] =
    data.scope === 'stargate'
      ? getSmoothStepPath({ ...pathArgs, borderRadius: 0 })
      : getBezierPath(pathArgs);
  const style = connectionStyle(data);
  const badges = connectionBadges(data);
  const hasLabel = badges.length > 0 || data.isRolling || data.preserveMass;
  // Absent entirely when the token withholds endpoint codes — no empty affordance.
  const sigIds = data.sigIds;
  const showSigTags = sigIds !== null && anchors !== null;
  const revealSigTags = showSigTags && (hovered || data.highlighted);

  const strokeWidth = data.highlighted
    ? style.strokeWidth + HIGHLIGHT_STROKE_BOOST_PX
    : style.strokeWidth;

  return (
    <>
      {data.sourceBubbled && (
        <ConnectionBubble
          gradientId={`pub-bubble-${props.id}-source`}
          path={path}
          strokeWidth={strokeWidth}
          anchor={sourceAnchor}
          far={targetAnchor}
        />
      )}
      {data.targetBubbled && (
        <ConnectionBubble
          gradientId={`pub-bubble-${props.id}-target`}
          path={path}
          strokeWidth={strokeWidth}
          anchor={targetAnchor}
          far={sourceAnchor}
        />
      )}
      <BaseEdge
        path={path}
        style={
          data.highlighted
            ? {
                ...style,
                strokeWidth,
                filter: `drop-shadow(0 0 6px ${style.stroke})`,
              }
            : style
        }
      />
      {showSigTags && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          style={{ pointerEvents: 'stroke' }}
          onMouseEnter={() => setHoverState(true)}
          onMouseLeave={() => setHoverState(false)}
        />
      )}
      {revealSigTags && (
        <EdgeLabelRenderer>
          <SigTag
            position={tagPosition(anchors.source, anchors.target, -1)}
            face={anchors.source.position}
            sigId={sigIds.source}
            farClassColor={systemClassColor(data.endpointSecurity.target)}
          />
          <SigTag
            position={tagPosition(anchors.target, anchors.source, 1)}
            face={anchors.target.position}
            sigId={sigIds.target}
            farClassColor={systemClassColor(data.endpointSecurity.source)}
          />
        </EdgeLabelRenderer>
      )}
      {hasLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute z-[1000] flex flex-col items-center gap-1"
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
              <div className="flex items-center gap-1">
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
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * The code to look for in the system this tag sits beside, flush against that
 * system's own tile face. An unscanned end reads as an explicit dash, so
 * "nobody has been through here" is never mistaken for a tag that failed to
 * render. The border carries the *far* system's class colour — the class of
 * the system this hole leads to — as a second cue independent of position.
 */
function SigTag({
  position,
  face,
  sigId,
  farClassColor,
}: {
  position: { x: number; y: number };
  face: Position;
  sigId: string | null;
  farClassColor: string;
}) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute z-[1000] rounded-sm border-2 bg-spec-rail px-1.5 py-0.5 font-spec-mono text-[11px] font-semibold leading-none shadow-md"
      style={{
        transform: `${tagTransformOrigin(face)} translate(${position.x}px, ${position.y}px)`,
        borderColor: farClassColor,
      }}
      aria-label={sigId ? `Signature ${sigId}` : 'This side has not been scanned'}
    >
      {sigId ? (
        <span className="text-spec-text">{sigId.slice(0, 3)}</span>
      ) : (
        <span className="text-spec-dim">—</span>
      )}
    </div>
  );
}

// A loud "do not jump" flag stacked above the connection label. Rolling and
// preserve-mass both mean the same thing to a pilot at the keyboard — keep your
// ship out of this hole.
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
