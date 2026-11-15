'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MapSystemNode } from '@/lib/map/loadMap';
import { mapUpdateLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine } from '@/lib/sounds/engine';

/**
 * Turns a rally point being set on any system of the open map into the
 * `rallySet` cue. Renders nothing. Mounted only when the account has the event
 * enabled — when absent, no cue fires.
 *
 * Only a `system.updated` carrying a non-null `rallyAt` sounds; clearing a
 * rally is silent. The canvas's own-echo dedupe does not apply here, so the
 * viewer who set the rally hears it too.
 */
export function RallySoundBridge({
  mapId,
  systems,
  homeMapSystemId,
}: {
  mapId: string;
  systems: MapSystemNode[];
  /** `ap_map_system.id` of the map's Home, or null. */
  homeMapSystemId: string | null;
}) {
  const systemsRef = useRef(systems);
  useEffect(() => {
    systemsRef.current = systems;
  });

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'mapUpdate') return;
        const parsed = mapUpdateLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.mapId !== Number(mapId)) return;
        const payload = parsed.data.data;
        if (payload?.kind !== 'system.updated' || payload.rallyAt == null) return;

        const system = systemsRef.current.find((s) => s.id === payload.id);
        getSoundEngine().play(
          'rallySet',
          system && {
            system: { systemId: system.systemId, isHome: system.id === homeMapSystemId },
          },
        );
      },
      [mapId, homeMapSystemId],
    ),
  );

  return null;
}
