'use client';

import type { MapViewData } from '@/types';
import { connectionBadges } from '@/components/map/styling';
import { systemDisplayName } from '@/lib/eve/drifterSystems';

export function ExperimentalMapSummary({ viewData }: { viewData: MapViewData }) {
  const systems = viewData.systems;
  const connections = viewData.connections;
  const eolLinks = connections.filter((c) => c.eolStage !== 'none').length;
  const onMapSystemIds = new Set(systems.map((s) => s.systemId));
  const pilotSystems = new Set(
    viewData.presence.filter((p) => onMapSystemIds.has(p.systemId)).map((p) => p.systemId),
  ).size;

  return (
    <div className="space-y-3 p-3 text-sm">
      <p className="font-heading text-base font-medium">Chain summary</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-muted-foreground">
        <dt>Systems</dt>
        <dd className="text-foreground">{systems.length}</dd>
        <dt>Pilot systems</dt>
        <dd className="text-foreground">{pilotSystems}</dd>
        <dt>EOL links</dt>
        <dd className="text-foreground">{eolLinks}</dd>
        <dt>Home</dt>
        <dd className="truncate text-foreground">
          {(() => {
            const home = systems.find((s) => s.id === viewData.map.homeMapSystemId);
            return home ? systemDisplayName(home.systemId, home.alias ?? home.name) : '—';
          })()}
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Select a system, connection, or note on the map to inspect. Link selection keeps your current tab.
      </p>
      {eolLinks > 0 ? (
        <ul className="max-h-32 space-y-1 overflow-auto text-xs">
          {connections
            .filter((c) => c.eolStage !== 'none')
            .slice(0, 8)
            .map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className="text-muted-foreground">
                  {connectionBadges(c)
                    .filter((b) => b.key === 'eol')
                    .map((b) => b.label)
                    .join(' ') || 'EOL'}
                </span>
                <span className="truncate">WH {c.id}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
