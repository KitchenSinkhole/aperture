'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MapSystemNode } from '@/lib/map/loadMap';
import { systemNotificationLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine } from '@/lib/sounds/engine';

/**
 * Turns a zKB kill in an on-map system into the `killInSystem` cue, alongside
 * the red underglow `MapUnderglowBridge` draws from the same envelope. Renders
 * nothing. Mounted only when the account has the event enabled — when absent,
 * no cue fires.
 *
 * A `ping` rides the same task and is not a kill, so only
 * `kind === 'killmail'` sounds.
 */
export function KillSoundBridge({
  mapId,
  systems,
}: {
  mapId: string;
  systems: MapSystemNode[];
}) {
  const systemsRef = useRef(systems);
  useEffect(() => {
    systemsRef.current = systems;
  });

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'systemNotification') return;
        const parsed = systemNotificationLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.kind !== 'killmail') return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports.
        if (parsed.data.mapId !== Number(mapId)) return;
        // The server's system-to-map index can trail a removal, so a system
        // this map no longer shows stays silent, as its underglow does.
        const { systemId } = parsed.data;
        if (!systemsRef.current.some((s) => s.systemId === systemId)) return;

        getSoundEngine().play('killInSystem');
      },
      [mapId],
    ),
  );

  return null;
}
