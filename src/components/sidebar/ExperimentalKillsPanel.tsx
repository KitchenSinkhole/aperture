'use client';

import { useEffect, useState } from 'react';
import type { MapSystemNode } from '@/types';
import { subscribeExperimentalPanelAdd } from '@/lib/experimentalPanelActionBus';
import { SystemKillboardModule } from './SystemKillboardModule';

/** Experimental chain kills — uses per-system killboard when a system is selected. */
export function ExperimentalKillsPanel({ system }: { system: MapSystemNode | undefined }) {
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(
    () => subscribeExperimentalPanelAdd('kills', () => setRefreshToken((n) => n + 1)),
    [],
  );

  if (!system) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Select a chain system to load its killboard for this map.
      </div>
    );
  }
  return <SystemKillboardModule key={`${system.id}-${refreshToken}`} system={system} />;
}
