'use client';

import type { ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PreviewCard } from '@base-ui/react/preview-card';
import { Tooltip } from '@base-ui/react/tooltip';
import {
  Atom,
  CircleDashed,
  Clock,
  Home,
  Lock,
  Radiation,
  Signal,
  Swords,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { MapPresenceEntry, MapSystemNode } from '@/lib/map/loadMap';
import { formatAgoFromMs } from '@/lib/map/relativeTime';
import {
  systemEffectBonuses,
  systemEffectName,
  type SystemEffectKey,
} from '@/lib/eve/systemEffects';
import { systemDisplayName, isDrifterSystem } from '@/lib/eve/drifterSystems';
import { isShatteredSystem } from '@/lib/eve/shatteredSystems';
import { homeAccentColor, systemClassColor, systemEffectColor, systemStatusColor } from './styling';
import { InlineTextEdit } from './InlineTextEdit';
import { PilotRosterTable } from './PilotRosterTable';
import { usePresenceForSystem } from './MapPresenceContext';
import { useSignatureIndicator } from './MapSignatureIndicatorContext';
import { useUnderglowForSystem } from './MapUnderglowContext';
import { SystemUnderglow } from './SystemUnderglow';
import { RALLY_UNDERGLOW } from './underglowPresets';
import React from 'react';

// System tile. Status stripe + security badge + tag + alias/name + presence
// badge + lock + a J-space statics line. Alias and tag are inline
// double-click-to-edit; all other edits (status, intel, rally, locked) live in
// the sidebar inspector. The presence badge shows the count of online tracked
// pilots currently in this system, with a hover panel listing each pilot and
// their ship.

export type SystemNodeData = MapSystemNode & {
  /** Wired by `MapCanvas`; absent on the read-only path. */
  onAliasOrTagCommit?: (mapSystemId: string, field: 'alias' | 'tag', next: string | null) => void;
  /** Derived in `MapCanvas` from the map's `homeMapSystemId`; marks this tile as the Home system. */
  isHome?: boolean;
  /** Derived in `MapCanvas` from the load-time intel: this system has a faction-warfare row. */
  inFactionWarfare?: boolean;
  /** Derived in `MapCanvas` from the load-time intel: this system is part of an active incursion. */
  hasIncursion?: boolean;
};

function securityLabel(node: MapSystemNode): string {
  if (node.security) return node.security;
  if (node.trueSec != null) return node.trueSec.toFixed(1);
  return '?';
}

/** Wormhole class number from a `C<n>` security label (e.g. "C3" → 3); null otherwise. */
function classIdFromSecurity(security: string | null): number | null {
  const m = security ? /^C(\d+)$/.exec(security) : null;
  return m ? Number(m[1]) : null;
}

const fixedStaticOrder: Record<string, SecurityRank> = {
  // Wormholes are index 0,
  "H": 1,
  "L": 2,
  "0.0": 3,
  "P": 4
};

type SecurityRank = number;
type ClassRank = number;

function getStaticRank(value: string): [SecurityRank, ClassRank] {
  const fixed = fixedStaticOrder[value];
  if (fixed !== undefined) {
    return [fixed, 0];
  }

  const match = value.match(/^C(\d+)$/);
  if (match) {
    return [0, parseInt(match[1]!, 10)]
  }

  return [5, 0];
}

export function staticCompare(a: string, b: string): number {
  const [ra1, ra2] = getStaticRank(a);
  const [rb1, rb2] = getStaticRank(b);
  return ra1 - rb1 || ra2 - rb2;
}

export function SystemNode({ data, selected }: NodeProps & { data: SystemNodeData }) {
  const color = systemStatusColor(data.status);
  const isWormhole = data.statics.length > 0 || /^J\d{6}$/.test(data.name);
  const onAliasOrTagCommit = data.onAliasOrTagCommit;
  const pilots = usePresenceForSystem(data.systemId);
  const glow = useUnderglowForSystem(data.id);
  const sigIndicator = useSignatureIndicator(data.id, isWormhole);

  const classColor = systemClassColor(data.security);
  const displayName = systemDisplayName(data.systemId, data.name);
  const isDrifter = isDrifterSystem(data.systemId);
  const isShattered = isShatteredSystem(data.name);

  // Compose the box-shadow as concentric rings: the resting ring is the system's
  // status colour (replacing the old neutral Tailwind `ring-1`), with the Home
  // accent and the selection halo stacking outside it at larger spreads so all
  // three can show at once. A soft drop shadow sits behind for slight elevation.
  const home = homeAccentColor();
  const boxShadow = [
    `0 0 0 1px ${color}`,
    data.isHome ? `0 0 0 2px ${home}` : '',
    selected ? `0 0 0 4px ${color}40, 0 0 16px 3px ${color}cc` : '',
    '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  ]
    .filter(Boolean)
    .join(', ');

  // Visible connection handles: large enough to grab at a glance, tinted with
  // the status colour and ringed against the node surface. `zIndex: -1` renders
  // them behind the tile so the inner sliver tucks under the node and the dot
  // never covers tile content; the per-side transforms push the bulk of each
  // dot outside its edge. The left dot gets an extra -4px to clear the thick
  // class-coloured stripe drawn on that edge.
  const handleBase = {
    width: 12,
    height: 12,
    background: color,
    border: '2px solid var(--map-node)',
    zIndex: -1,
  };
  // Hidden at rest; fade in only while the tile is hovered.
  const handleClass = 'opacity-0 transition-opacity duration-100 group-hover:opacity-[0.85]';
  const handleStyles = {
    top: { ...handleBase, transform: 'translate(-50%, -75%)' },
    right: { ...handleBase, transform: 'translate(75%, -50%)' },
    bottom: { ...handleBase, transform: 'translate(-50%, 75%)' },
    left: { ...handleBase, transform: 'translate(calc(-75% - 4px), -50%)' },
  };

  const orderedStatics = React.useMemo(() => {
    return data.statics.sort(staticCompare);
  }, [data.statics]);

  return (
    <div
      className="group relative min-w-30 cursor-pointer rounded-md bg-map-node text-xs text-card-foreground transition-[box-shadow,outline,transform] duration-50"
      style={{
        borderLeft: `4px solid ${classColor}`,
        // Selected tiles get a prominent halo in their status colour: a solid
        // offset ring plus a soft outer glow, so selection reads at a glance
        // regardless of the (often muted) status stripe. `${color}NN` appends an
        // 8-digit-hex alpha to the status hex.
        outline: selected ? `2px solid ${color}` : 'none',
        outlineOffset: selected ? '3px' : undefined,
        boxShadow,
        transform: selected ? 'scale(1.01)' : undefined,
      }}
    >
      {/* Persistent rally underglow, derived straight from map state so it lives
          exactly as long as `rallyAt` is set. Kept separate from the transient
          store glow below so a coinciding killmail/ping can't clear it. */}
      {data.rallyAt && <SystemUnderglow {...RALLY_UNDERGLOW} />}
      {glow && <SystemUnderglow key={glow.token} {...glow.config} />}
      <SignatureIndicators
        stale={sigIndicator.stale}
        ageMs={sigIndicator.ageMs}
        unscanned={sigIndicator.unscanned}
      />
      <IntelIndicators
        inFactionWarfare={!!data.inFactionWarfare}
        hasIncursion={!!data.hasIncursion}
      />
      {/* Each handle carries a unique id so xyflow resolves the actual grabbed /
          hovered handle. Without an id, `getHandle` falls back to `handles[0]`
          (the first declared = Top), which pins both the drag origin and the
          snap target to the top handle regardless of which side is in play. */}
      <Handle
        type="source"
        id="top"
        position={Position.Top}
        className={handleClass}
        style={handleStyles.top}
      />
      <Handle
        type="source"
        id="right"
        position={Position.Right}
        className={handleClass}
        style={handleStyles.right}
      />
      <Handle
        type="source"
        id="bottom"
        position={Position.Bottom}
        className={handleClass}
        style={handleStyles.bottom}
      />
      <Handle
        type="source"
        id="left"
        position={Position.Left}
        className={handleClass}
        style={handleStyles.left}
      />

      <div className="flex items-stretch">
        {/* Left column: security class + tag, the visual leads, sized up and
            stacked so they read at a glance when zoomed out. */}
        <div className="flex flex-col items-center justify-center gap-0.5 border-r border-foreground/10 px-1.5 leading-none">
          <span
            className="font-mono text-sm font-bold leading-none"
            style={{ color: systemClassColor(data.security) }}
          >
            {securityLabel(data)}
          </span>
          {onAliasOrTagCommit ? (
            <InlineTextEdit
              value={data.tag}
              placeholder=""
              ariaLabel="Tag"
              maxLength={50}
              onCommit={(next) => onAliasOrTagCommit(data.id, 'tag', next)}
              className="font-mono text-lg font-bold leading-none empty:hidden"
              style={{ color: systemClassColor(data.security) }}
              inputClassName="w-12"
            />
          ) : (
            data.tag && (
              <span
                className="font-mono text-lg font-bold leading-none"
                style={{ color: systemClassColor(data.security) }}
              >
                {data.tag}
              </span>
            )
          )}
        </div>

        {/* Right column: system name on top, statics / region underneath. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
          <div className="flex items-center gap-1 px-2">
            {onAliasOrTagCommit ? (
              <InlineTextEdit
                value={data.alias}
                placeholder={displayName}
                ariaLabel="Alias"
                maxLength={100}
                onCommit={(next) => onAliasOrTagCommit(data.id, 'alias', next)}
                className="flex-1 truncate font-mono tracking-[0.02em] text-base text-foreground"
                inputClassName="w-full"
              />
            ) : (
              <span className="flex-1 truncate font-mono tracking-[0.01em] text-base text-foreground">
                {data.alias ?? displayName}
              </span>
            )}
            {pilots.length > 0 && <PresenceBadge pilots={pilots} />}
            {data.tradeHub && (
              <IndicatorPill
                className="text-emerald-400 ring-emerald-400/40"
                label={`${data.tradeHub.jumps} jump${data.tradeHub.jumps === 1 ? '' : 's'} to ${data.tradeHub.name}`}
              >
                {data.tradeHub.jumps}
                {data.tradeHub.name.charAt(0).toUpperCase()}
              </IndicatorPill>
            )}
            {isShattered && (
              <SystemKindIcon
                icon={CircleDashed}
                label="Shattered system"
                className="text-rose-400"
              />
            )}
            {isDrifter && (
              <SystemKindIcon icon={Atom} label="Drifter wormhole" className="text-violet-400" />
            )}
            {data.isHome && (
              <Home className="size-3" style={{ color: home }} aria-label="Home system" />
            )}
            {data.locked && <Lock className="size-3 text-muted-foreground" />}
          </div>

          <div className="flex items-center gap-1 px-2 text-[10px] text-muted-foreground">
            {isWormhole ? (
              <>
                {orderedStatics.length > 0 && (
                  <span className="flex items-center gap-1">
                    {orderedStatics.map((cls, i) => (
                      <span key={i} className="font-bold" style={{ color: systemClassColor(cls) }}>
                        {cls}
                      </span>
                    ))}
                  </span>
                )}
                {data.effect && (
                  <EffectIndicator
                    effect={data.effect as SystemEffectKey}
                    classId={classIdFromSecurity(data.security)}
                  />
                )}
              </>
            ) : (
              <span className="truncate">{data.regionName}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "3h ago" → "3h" for the compact badge; sub-minute reads empty. */
function compactAge(ms: number): string {
  const label = formatAgoFromMs(ms);
  return label === 'just now' ? '' : label.replace(' ago', '');
}

/**
 * Stale (clock) and unscanned (signal) indicators, floating just off the
 * top-right corner of the tile. `pointer-events-none` so they never swallow a
 * node click; `nodrag nopan` keeps xyflow from panning if one is grabbed.
 */
function SignatureIndicators({
  stale,
  ageMs,
  unscanned,
}: {
  stale: boolean;
  ageMs: number | null;
  unscanned: number;
}) {
  if (!stale && unscanned === 0) return null;
  return (
    // `pointer-events-none` on the wrapper keeps the gaps between pills from
    // swallowing node clicks; each pill re-enables pointer events so its
    // tooltip can open on hover/focus.
    <div className="nodrag nopan pointer-events-none absolute -top-2 -right-2 flex items-center gap-1">
      {stale && (
        <IndicatorPill
          className="text-amber-400 ring-amber-400/40"
          label={
            ageMs != null
              ? `Signatures last updated ${formatAgoFromMs(ageMs)}`
              : 'No signatures scanned'
          }
        >
          <Clock className="size-2.5" aria-hidden />
          {ageMs != null && compactAge(ageMs)}
        </IndicatorPill>
      )}
      {unscanned > 0 && (
        <IndicatorPill
          className="text-sky-400 ring-sky-400/40"
          label={`${unscanned} unscanned signature${unscanned === 1 ? '' : 's'}`}
        >
          <Signal className="size-2.5" aria-hidden />
          {unscanned}
        </IndicatorPill>
      )}
    </div>
  );
}

/**
 * Faction-warfare and incursion indicators, floating just off the bottom-right
 * corner of the tile. Mirrors `SignatureIndicators` (same pill look, off-border
 * float) but pinned to the opposite corner so the two sets never collide.
 * `pointer-events-none` so they never swallow a node click; `nodrag nopan` keeps
 * xyflow from panning if one is grabbed. Fed by load-time intel, so the flags
 * reflect map-load state (no realtime), like the Home marker.
 */
function IntelIndicators({
  inFactionWarfare,
  hasIncursion,
}: {
  inFactionWarfare: boolean;
  hasIncursion: boolean;
}) {
  if (!inFactionWarfare && !hasIncursion) return null;
  return (
    <div className="nodrag nopan pointer-events-none absolute -right-2 -bottom-2 flex items-center gap-1">
      {inFactionWarfare && (
        <IndicatorPill
          className="text-orange-400 ring-orange-400/40"
          label="Faction Warfare system"
        >
          <Swords className="size-2.5" aria-hidden />
        </IndicatorPill>
      )}
      {hasIncursion && (
        <IndicatorPill className="text-red-400 ring-red-400/40" label="Active incursion">
          <Radiation className="size-2.5" aria-hidden />
        </IndicatorPill>
      )}
    </div>
  );
}

/**
 * One signature-indicator pill with a hover/focus tooltip explaining what it
 * means. `pointer-events-auto` overrides the wrapper so the tooltip can open;
 * `nodrag nopan` keeps the interaction from panning the canvas.
 */
function IndicatorPill({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        className={`nodrag nopan pointer-events-auto inline-flex items-center gap-0.5 rounded-full bg-card px-1 py-0.5 text-[9px] font-semibold leading-none shadow-sm ring-1 ${className}`}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Head-row badge marking a special wormhole-system kind (shattered / Drifter).
 * A bare lucide icon with a hover/focus tooltip naming the kind, surfacing at a
 * glance what an experienced reader could infer from the J-sig. Rendered as a `span` so clicks still
 * bubble through to node selection; `nodrag nopan` keeps the hover from panning.
 */
function SystemKindIcon({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        className={`nodrag nopan inline-flex shrink-0 ${className}`}
        aria-label={label}
      >
        <Icon className="size-3" aria-hidden />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Small colour-coded square marking a W-space system's anomaly effect, pinned to
 * the right of the footer row (`ml-auto`). Hover/focus opens a panel listing the
 * effect's bonuses resolved to this system's class. `nodrag nopan` so the
 * interaction never starts a canvas pan/drag.
 */
function EffectIndicator({ effect, classId }: { effect: SystemEffectKey; classId: number | null }) {
  const color = systemEffectColor(effect);
  const name = systemEffectName(effect);
  const bonuses = classId != null ? systemEffectBonuses(effect, classId) : [];

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        render={<button type="button" />}
        className="nodrag nopan ml-auto size-2.5 shrink-0 rounded-xs ring-1 ring-foreground/25"
        style={{ backgroundColor: color }}
        aria-label={`System effect: ${name}`}
      />
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={4} side="bottom" align="end">
          <PreviewCard.Popup className="nodrag nopan z-50 min-w-44 rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <span
                className="size-2.5 rounded-xs ring-1 ring-foreground/25"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              {name}
            </div>
            {bonuses.length > 0 ? (
              <ul className="space-y-0.5">
                {bonuses.map((b) => (
                  <li key={b.effect} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{b.effect}</span>
                    <span className="font-mono tabular-nums">{b.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No bonuses for this class.</p>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

function PresenceBadge({ pilots }: { pilots: readonly MapPresenceEntry[] }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        // `nodrag nopan` so opening the hover panel doesn't trigger xyflow's
        // pan/drag — same pattern as InlineTextEdit. Render as a button so
        // it's keyboard-focusable; default `<a>` would suggest a navigation.
        render={<button type="button" />}
        className="nodrag nopan inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-tight text-primary-foreground"
        aria-label={`${pilots.length} pilot${pilots.length === 1 ? '' : 's'} in system`}
      >
        <Users className="size-2.5" aria-hidden />
        {pilots.length}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={4} side="top" align="end">
          <PreviewCard.Popup className="nodrag nopan z-50 min-w-40 rounded-md border bg-popover p-0 text-xs text-popover-foreground shadow-md">
            <PilotRosterTable
              presence={pilots}
              showHeaders={false}
              showLocationColumn={false}
              scrollable={false}
            />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
