'use client';

import { Tooltip } from '@base-ui/react/tooltip';
import { systemSecurityColor } from '@/components/map/styling';
import { routeSpaceKind } from '@/lib/map/routeSegments';
import type { RouteHop } from '@/types';

const VIA_LABELS: Record<RouteHop['via'], string> = {
  origin: 'Start',
  gate: 'via gate',
  wh: 'via wormhole',
  jumpbridge: 'via jumpbridge',
  eve_scout: 'via EVE-Scout',
};

/** Hop markers in a row — same strip as the Routes panel breadcrumb. */
export function RouteHopBreadcrumb({
  hops,
  onHopClick,
}: {
  hops: readonly RouteHop[];
  onHopClick?: (eveSystemId: number) => void;
}) {
  if (hops.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-[3px]">
      {hops.map((hop, i) => (
        <HopSquare key={`${hop.systemId}-${i}`} hop={hop} onHopClick={onHopClick} />
      ))}
    </div>
  );
}

/**
 * One route hop as a small security-coloured marker; system name on hover.
 * Wormhole (J-space) systems render as circles, K-space systems as squares.
 */
export function HopSquare({
  hop,
  onHopClick,
}: {
  hop: RouteHop;
  onHopClick?: (eveSystemId: number) => void;
}) {
  const isWormhole = routeSpaceKind(hop.security, hop.name) === 'jspace';
  const clickable = hop.onMap && onHopClick != null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={<span />}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onHopClick!(hop.systemId) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onHopClick!(hop.systemId);
                }
              }
            : undefined
        }
        className={`size-3 shrink-0 ${isWormhole ? 'rounded-full' : ''} ${
          clickable ? 'cursor-pointer ring-offset-1 hover:ring-2 hover:ring-primary/40' : ''
        }`}
        style={{ backgroundColor: systemSecurityColor(hop.security, hop.securityStatus) }}
        aria-label={hop.name}
      />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            {hop.tag && <span className="mr-1 font-mono text-muted-foreground">[{hop.tag}]</span>}
            <span style={{ color: systemSecurityColor(hop.security, hop.securityStatus) }}>{hop.name}</span>
            <span className="ml-1 text-muted-foreground">{VIA_LABELS[hop.via]}</span>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
