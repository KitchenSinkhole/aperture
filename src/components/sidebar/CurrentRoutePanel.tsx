'use client';

import { useMemo } from 'react';
import type { MapActiveRouteView, MapViewData } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { systemSecurityColor } from '@/components/map/styling';
import { remainingActiveRouteHops, activeRouteProgressIndex } from '@/lib/map/activeRouteMonitor';
import { RouteHopBreadcrumb } from '@/components/sidebar/RouteHopMarkers';

export function CurrentRoutePanel({
  activeRoute,
  viewData,
  primaryCharacterId,
  onSetRoute,
  onStopRoute,
  onHopClick,
}: {
  activeRoute: MapActiveRouteView | null;
  viewData: MapViewData;
  primaryCharacterId: number | null;
  onSetRoute?: () => void;
  /** Clears the owner's `ap_map_active_route` row (followers included). */
  onStopRoute?: () => void;
  onHopClick?: (eveSystemId: number) => void;
}) {
  const presenceByChar = useMemo(() => {
    const m = new Map<number, MapViewData['presence'][number]>();
    for (const p of viewData.presence) m.set(p.characterId, p);
    return m;
  }, [viewData.presence]);

  const primarySystemId =
    primaryCharacterId != null ? presenceByChar.get(primaryCharacterId)?.systemId ?? null : null;

  if (!activeRoute) {
    return (
      <Card className="h-full gap-0 py-0 ring-0">
        <CardContent className="p-3 text-sm text-muted-foreground">
          No active route. Plan a route and choose <strong className="text-foreground">Set route</strong> to push
          ESI waypoints (k-space legs only).
        </CardContent>
      </Card>
    );
  }

  const progressIndex = activeRouteProgressIndex(
    activeRoute.hops,
    activeRoute.waypointCursor,
    primarySystemId,
  );
  const remainingHops = remainingActiveRouteHops(
    activeRoute.hops,
    activeRoute.waypointCursor,
    primarySystemId,
  );
  const destHop = activeRoute.hops.at(-1);

  return (
    <Card className="h-full gap-0 py-0 ring-0">
      <CardContent className="flex flex-col gap-2 p-3 text-sm">
        <div className="flex flex-col gap-1 rounded-md border border-border/60 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
              <span className="flex items-center gap-1.5">
                <span
                  style={{
                    color: destHop
                      ? systemSecurityColor(destHop.security, destHop.securityStatus)
                      : undefined,
                  }}
                >
                  {activeRoute.destinationName}
                </span>
                {remainingHops.length > 0 ? (
                  <span className="font-mono text-muted-foreground">
                    {Math.max(0, remainingHops.length - 1)}j
                  </span>
                ) : null}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {activeRoute.followerCharacterIds.length} follower
                {activeRoute.followerCharacterIds.length === 1 ? '' : 's'}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {onSetRoute ? (
                <button
                  type="button"
                  onClick={onSetRoute}
                  className="text-[10px] text-primary hover:underline"
                >
                  Refresh waypoints
                </button>
              ) : null}
              {onStopRoute ? (
                <button
                  type="button"
                  onClick={onStopRoute}
                  className="text-[10px] text-muted-foreground hover:text-destructive"
                >
                  Stop
                </button>
              ) : null}
            </span>
          </div>
          <RouteHopBreadcrumb hops={remainingHops} onHopClick={onHopClick} />
        </div>

        {activeRoute.followerCharacterIds.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {activeRoute.followerCharacterIds.map((cid) => {
              const p = presenceByChar.get(cid);
              const sys = p
                ? viewData.systems.find((s) => s.systemId === p.systemId)?.alias ??
                  viewData.systems.find((s) => s.systemId === p.systemId)?.name
                : null;
              return (
                <li key={cid} className="flex gap-2">
                  <span className="text-foreground">{p?.characterName ?? `Char ${cid}`}</span>
                  <span className="truncate">{sys ?? '—'}</span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Hop {progressIndex + 1} of {activeRoute.hops.length}
        </p>
      </CardContent>
    </Card>
  );
}
