'use client';

import { useCallback } from 'react';
import { systemNotificationLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import type { MapSystemNode } from '@/lib/map/loadMap';
import { useExperimentalCombatRingActions } from './ExperimentalCombatRingContext';

/** Marks on-map systems with a combat ring after a killmail notification (experimental). */
export function ExperimentalCombatKillBridge({
  mapId,
  systems,
}: {
  mapId: string;
  systems: readonly MapSystemNode[];
}) {
  const { markKill } = useExperimentalCombatRingActions();
  const byEveId = useCallback(
    (systemId: number) => systems.find((s) => s.systemId === systemId)?.id,
    [systems],
  );

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'systemNotification') return;
        const parsed = systemNotificationLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.kind !== 'killmail') return;
        if (parsed.data.mapId !== Number(mapId)) return;
        const mapSystemId = byEveId(parsed.data.systemId);
        if (mapSystemId) markKill(mapSystemId);
      },
      [byEveId, mapId, markKill],
    ),
  );

  return null;
}
