'use client';

import { useMemo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PreviewCard } from '@base-ui/react/preview-card';
import { Tooltip } from '@base-ui/react/tooltip';
import { Atom, CircleDashed, Home, type LucideIcon } from 'lucide-react';
import { ShipClassIcon } from '@/components/icons/ShipClassIcon';
import { SystemPresenceTable } from '@/components/map/SystemPresenceTable';
import {
  homeAccentColor,
  systemClassColor,
  systemEffectColor,
  systemStatusColor,
} from '@/components/map/styling';
import { isDrifterSystem, systemDisplayName } from '@/lib/eve/drifterSystems';
import { isShatteredSystem } from '@/lib/eve/shatteredSystems';
import { SHIP_CLASS_LABELS } from '@/lib/eve/shipClass';
import {
  systemEffectBonuses,
  systemEffectName,
  type SystemEffectKey,
} from '@/lib/eve/systemEffects';
import { staticCompare } from '@/lib/map/staticOrder';
import type { PublicMapSystemNode, PublicPresencePilot, ShipClass } from '@/types';

// Spectator system tile. The same visual language as the app's `SystemNode` —
// status ring, class stripe, security badge, tag, name, statics — with the whole
// interaction layer absent: no connect handles, no inline editing, no lock,
// rally, or signature-freshness state. Presence renders at whatever fidelity the
// share token permits.

/** Per-system presence at the fidelity the token's `presenceMode` allows. */
export type PublicNodePresence =
  | { mode: 'anonymous'; count: number; byClass: { shipClass: ShipClass; count: number }[] }
  | { mode: 'full'; pilots: PublicPresencePilot[] };

export type PublicSystemNodeData = PublicMapSystemNode & {
  presence: PublicNodePresence | null;
  /** Set while the matching entrances-board row is hovered. */
  highlighted: boolean;
};

const HANDLE_SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const;

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none', width: 1, height: 1 } as const;

function securityLabel(node: PublicMapSystemNode): string {
  if (node.security) return node.security;
  if (node.trueSec != null) return node.trueSec.toFixed(1);
  return '?';
}

/** Wormhole class number from a `C<n>` security label (e.g. "C3" → 3); null otherwise. */
function classIdFromSecurity(security: string | null): number | null {
  const m = security ? /^C(\d+)$/.exec(security) : null;
  return m ? Number(m[1]) : null;
}

export function PublicSystemNode({ data }: NodeProps & { data: PublicSystemNodeData }) {
  const color = systemStatusColor(data.status);
  const classColor = systemClassColor(data.security);
  const isWormhole = data.statics.length > 0 || /^J\d{6}$/.test(data.name);
  const displayName = systemDisplayName(data.systemId, data.name);

  const orderedStatics = useMemo(
    () => [...data.statics].sort((a, b) => staticCompare(a.label, b.label)),
    [data.statics],
  );

  // Concentric rings: the resting ring carries the system's status colour, the
  // Home accent sits outside it, and the board-hover highlight stacks a wider
  // halo in the class colour so a row and its tile read as the same thing.
  const home = homeAccentColor();
  const boxShadow = [
    `0 0 0 1px ${color}`,
    data.isHome ? `0 0 0 2px ${home}` : '',
    data.highlighted ? `0 0 0 4px ${classColor}55, 0 0 20px 4px ${classColor}aa` : '',
    '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className="relative min-w-30 rounded-md bg-map-node text-xs text-card-foreground transition-[box-shadow] duration-100"
      style={{ borderLeft: `4px solid ${classColor}`, boxShadow }}
    >
      {data.presence && <PublicPresenceBadge presence={data.presence} />}

      {/* xyflow attaches an edge to a node's handles, so an edge cannot be
          created against a node that declares none — even though
          `PublicConnectionEdge` computes its own anchors and ignores which
          handle an edge nominally uses. These are invisible and inert. */}
      {HANDLE_SIDES.map(([id, position]) => (
        <Handle key={id} type="source" id={id} position={position} style={HIDDEN_HANDLE} />
      ))}

      <div className="flex items-stretch">
        <div className="flex flex-col items-center justify-center gap-0.5 border-r border-foreground/10 px-1.5 leading-none">
          <span className="font-mono text-sm font-bold leading-none" style={{ color: classColor }}>
            {securityLabel(data)}
          </span>
          {data.tag && (
            <span className="font-mono text-lg font-bold leading-none" style={{ color: classColor }}>
              {data.tag}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
          <div className="flex items-center gap-1 px-2">
            <span className="flex-1 truncate font-mono tracking-[0.01em] text-base text-foreground">
              {displayName}
            </span>
            {data.tradeHub && (
              <IndicatorPill
                className="text-emerald-400 ring-emerald-400/40"
                label={`${data.tradeHub.jumps} jump${data.tradeHub.jumps === 1 ? '' : 's'} to ${data.tradeHub.name}`}
              >
                {data.tradeHub.jumps}
                {data.tradeHub.name.charAt(0).toUpperCase()}
              </IndicatorPill>
            )}
            {isShatteredSystem(data.name) && (
              <SystemKindIcon
                icon={CircleDashed}
                label="Shattered system"
                className="text-rose-400"
              />
            )}
            {isDrifterSystem(data.systemId) && (
              <SystemKindIcon icon={Atom} label="Drifter wormhole" className="text-violet-400" />
            )}
            {data.isHome && <SystemKindIcon icon={Home} label="Home system" color={home} />}
          </div>

          <div className="flex items-center gap-1 px-2 text-[10px] text-muted-foreground">
            {isWormhole ? (
              <>
                {orderedStatics.length > 0 && (
                  <span className="flex items-center gap-1">
                    {orderedStatics.map((s, i) => (
                      <StaticLabel key={i} label={s.label} />
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

/**
 * A static's target-class label. The app's version opens a wormhole reference
 * card, which reads a session-gated endpoint; here the label names its class and
 * stops there.
 */
function StaticLabel({ label }: { label: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        className="nodrag nopan font-bold"
        style={{ color: systemClassColor(label) }}
      >
        {label}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            Static wormhole to {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A small pill with a hover/focus tooltip, floating against the tile. */
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
        className={`nodrag nopan inline-flex items-center gap-0.5 rounded-full bg-card px-1 py-0.5 text-[9px] font-semibold leading-none shadow-sm ring-1 ${className}`}
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

/** Head-row badge marking a special system kind (shattered / Drifter / Home). */
function SystemKindIcon({
  icon: Icon,
  label,
  className = '',
  color,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  /** Inline colour, for accents that live outside the Tailwind palette. */
  color?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        className={`nodrag nopan inline-flex shrink-0 ${className}`}
        style={color ? { color } : undefined}
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

/** Colour-coded square marking a W-space system's anomaly effect. */
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

/**
 * Tracked-pilot count off the tile's top-left corner. The hover panel's contents
 * follow the token's presence mode: hull-class buckets when the roster is
 * anonymous, the pilot list when it is published in full.
 */
function PublicPresenceBadge({ presence }: { presence: PublicNodePresence }) {
  const count = presence.mode === 'full' ? presence.pilots.length : presence.count;
  if (count === 0) return null;

  return (
    <div className="nodrag nopan pointer-events-none absolute left-1.5 top-1.5 flex -translate-x-full -translate-y-full items-center gap-1">
      <PreviewCard.Root>
        <PreviewCard.Trigger
          render={<button type="button" />}
          className="nodrag nopan pointer-events-auto inline-flex items-center rounded-full bg-card px-2 py-1 text-sm font-semibold leading-none text-primary shadow-sm ring-1 ring-primary/40"
          aria-label={`${count} pilot${count === 1 ? '' : 's'} in system`}
        >
          {count}
        </PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner sideOffset={4} side="top" align="start">
            <PreviewCard.Popup className="nodrag nopan z-50 min-w-40 rounded-md border bg-popover p-0 text-xs text-popover-foreground shadow-md">
              {presence.mode === 'full' ? (
                <SystemPresenceTable presence={presence.pilots} />
              ) : (
                <HullClassBreakdown byClass={presence.byClass} count={count} />
              )}
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </div>
  );
}

/**
 * What an anonymous roster can say: how many hulls of each class, and how many
 * pilots the buckets don't account for (a pilot whose ship type hasn't resolved).
 */
function HullClassBreakdown({
  byClass,
  count,
}: {
  byClass: { shipClass: ShipClass; count: number }[];
  count: number;
}) {
  const bucketed = byClass.reduce((sum, b) => sum + b.count, 0);
  return (
    <div className="px-2 py-1.5">
      {byClass.length > 0 ? (
        <ul className="space-y-1">
          {byClass.map((b) => (
            <li key={b.shipClass} className="flex items-center gap-2">
              <ShipClassIcon shipClass={b.shipClass} />
              <span className="flex-1 text-muted-foreground">{SHIP_CLASS_LABELS[b.shipClass]}</span>
              <span className="font-mono tabular-nums">{b.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {bucketed < count && (
        <p className="pt-1 text-muted-foreground">
          {count - bucketed} unidentified {count - bucketed === 1 ? 'hull' : 'hulls'}
        </p>
      )}
    </div>
  );
}
