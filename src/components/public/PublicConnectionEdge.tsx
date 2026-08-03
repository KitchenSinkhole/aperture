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
import { connectionBadges, connectionStyle } from '@/components/map/styling';
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

export type PublicConnectionEdgeData = PublicMapConnectionEdge;

/** How far a sig tag sits from its endpoint, along the edge. */
const SIG_TAG_ALONG_PX = 26;
/** How far a sig tag sits off the line. The two ends go opposite ways. */
const SIG_TAG_PERP_PX = 15;
/** Ceiling on the along-edge offset, as a share of the gap between endpoints. */
const SIG_TAG_ALONG_MAX_SHARE = 0.35;

/**
 * Places a tag beside its own endpoint. The along-edge nudge is capped at a
 * share of the gap so neither tag ever drifts past the midpoint, and the two
 * ends sit on opposite sides of the line (`perpSign`) so they stay legible even
 * when the two systems are placed almost touching.
 */
function tagPosition(anchor: EdgeAnchor, other: EdgeAnchor, perpSign: 1 | -1): { x: number; y: number } {
  const gap = Math.hypot(other.x - anchor.x, other.y - anchor.y);
  const along = Math.min(SIG_TAG_ALONG_PX, gap * SIG_TAG_ALONG_MAX_SHARE);
  const perp = SIG_TAG_PERP_PX * perpSign;
  switch (anchor.position) {
    case Position.Right:
      return { x: anchor.x + along, y: anchor.y + perp };
    case Position.Left:
      return { x: anchor.x - along, y: anchor.y + perp };
    case Position.Bottom:
      return { x: anchor.x + perp, y: anchor.y + along };
    case Position.Top:
      return { x: anchor.x + perp, y: anchor.y - along };
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

  const anchors = useEdgeAnchors(props.id, source, target);

  const pathArgs = {
    sourceX: anchors?.source.x ?? sourceX,
    sourceY: anchors?.source.y ?? sourceY,
    sourcePosition: anchors?.source.position ?? sourcePosition,
    targetX: anchors?.target.x ?? targetX,
    targetY: anchors?.target.y ?? targetY,
    targetPosition: anchors?.target.position ?? targetPosition,
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

  return (
    <>
      <BaseEdge path={path} style={style} />
      {showSigTags && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          style={{ pointerEvents: 'stroke' }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      )}
      {showSigTags && hovered && (
        <EdgeLabelRenderer>
          <SigTag
            position={tagPosition(anchors.source, anchors.target, -1)}
            sigId={sigIds.source}
          />
          <SigTag
            position={tagPosition(anchors.target, anchors.source, 1)}
            sigId={sigIds.target}
          />
        </EdgeLabelRenderer>
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
 * The code to look for in the system this tag sits beside. An unscanned end
 * reads as an explicit dash, so "nobody has been through here" is never
 * mistaken for a tag that failed to render.
 */
function SigTag({
  position,
  sigId,
}: {
  position: { x: number; y: number };
  sigId: string | null;
}) {
  return (
    <div
      className="nodrag nopan pointer-events-none absolute rounded-sm border border-spec-line bg-spec-rail px-1.5 py-0.5 font-spec-mono text-[11px] font-semibold leading-none shadow-md"
      style={{ transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)` }}
      title={sigId ? `Signature ${sigId}` : 'This side has not been scanned'}
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
