'use client';

import { Crown, User } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ShipClassIcon } from '@/components/icons/ShipClassIcon';
import { Tooltip } from '@base-ui/react/tooltip';
import type { SystemStatsSummary } from '@/lib/map/stats';
import {
  pilotLocationFadeOpacity,
  pilotNameToneClass,
  pilotStandingFromSystemStatus,
} from '@/lib/experimentalPilotPresence';
import { formatAgoFromMs } from '@/lib/map/relativeTime';
import { cn } from '@/lib/utils';
import type { MapSystemNode, MapViewData } from '@/types';
import type { SystemStatus } from '@/lib/map/enumLabels';

export function ExperimentalPilotsPanel({
  viewData,
  stats,
  linkedMapSystemId,
  onHoverSystem,
  onSelectSystem,
}: {
  viewData: MapViewData;
  stats?: Record<number, SystemStatsSummary>;
  /** Highlights the matching system group (map hover or selection). */
  linkedMapSystemId?: string | null;
  onHoverSystem?: (mapSystemId: string | null) => void;
  onSelectSystem?: (mapSystemId: string) => void;
}) {
  const bySystem = useMemo(() => {
    const map = new Map<string, typeof viewData.presence>();
    for (const p of viewData.presence) {
      const ms = viewData.systems.find((s) => s.systemId === p.systemId);
      if (!ms) continue;
      const list = map.get(ms.id) ?? [];
      list.push(p);
      map.set(ms.id, list);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [viewData]);

  if (bySystem.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No pilots on the chain.</div>;
  }

  return (
    <ul className="divide-y text-xs">
      {bySystem.map(([mapSystemId, pilots]) => (
        <SystemPilotGroup
          key={mapSystemId}
          mapSystemId={mapSystemId}
          system={viewData.systems.find((s) => s.id === mapSystemId)!}
          pilots={pilots}
          stats={stats?.[viewData.systems.find((s) => s.id === mapSystemId)?.systemId ?? 0]}
          linked={linkedMapSystemId === mapSystemId}
          onHoverSystem={onHoverSystem}
          onSelectSystem={onSelectSystem}
        />
      ))}
    </ul>
  );
}

function SystemPilotGroup({
  mapSystemId,
  system,
  pilots,
  stats,
  linked,
  onHoverSystem,
  onSelectSystem,
}: {
  mapSystemId: string;
  system: MapSystemNode;
  pilots: MapViewData['presence'];
  stats?: SystemStatsSummary;
  linked: boolean;
  onHoverSystem?: (id: string | null) => void;
  onSelectSystem?: (id: string) => void;
}) {
  const standing = pilotStandingFromSystemStatus(system.status as SystemStatus);
  const hotKills = (stats?.shipKills ?? 0) > 0;
  return (
    <li
      className={cn(linked && 'ap-pilots-panel-linked bg-primary/10')}
      onMouseEnter={() => onHoverSystem?.(mapSystemId)}
      onMouseLeave={() => onHoverSystem?.(null)}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 bg-muted/40 px-2 py-1 text-left font-medium hover:bg-muted/60"
        onClick={() => onSelectSystem?.(mapSystemId)}
      >
        <span className="truncate">{system.alias ?? system.name}</span>
        {system.tag ? (
          <Tooltip.Root>
            <Tooltip.Trigger className="shrink-0 font-mono text-[10px] text-muted-foreground">
              [{system.tag}]
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner sideOffset={4}>
                <Tooltip.Popup className="z-50 rounded-md border bg-popover px-2 py-1 text-xs shadow-md">
                  Corp / fleet ticker: {system.tag}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        ) : null}
        <span className="text-muted-foreground"> ({pilots.length})</span>
        {hotKills ? (
          <span className="ml-auto text-[10px] text-amber-400" title="Recent ship kills on this system">
            {stats!.shipKills} kills/24h
          </span>
        ) : null}
      </button>
      <ul>
        {pilots.map((p) => (
          <PilotRow key={p.characterId} pilot={p} standing={standing} />
        ))}
      </ul>
    </li>
  );
}

function PilotRow({
  pilot,
  standing,
}: {
  pilot: MapViewData['presence'][number];
  standing: ReturnType<typeof pilotStandingFromSystemStatus>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const fade = pilotLocationFadeOpacity(pilot.locationAt, now);
  const isMain =
    pilot.mainCharacterId !== null && pilot.characterId === pilot.mainCharacterId;
  const ts = Date.parse(pilot.locationAt);
  const ms = Number.isNaN(ts) ? 0 : now - ts;

  return (
    <li
      className="flex items-center gap-2 px-2 py-1"
      style={{ opacity: fade }}
    >
      <span className="flex w-4 shrink-0 justify-center text-muted-foreground" title={isMain ? 'Main' : 'Alt'}>
        {isMain ? <Crown className="size-3 text-amber-400" aria-hidden /> : <User className="size-3" aria-hidden />}
      </span>
      <ShipClassIcon shipClass={pilot.shipClass} />
      <span className={cn('truncate', pilotNameToneClass(standing))}>{pilot.characterName}</span>
      <span className="truncate text-muted-foreground">{pilot.shipTypeName ?? '—'}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">{formatAgoFromMs(ms)}</span>
    </li>
  );
}
