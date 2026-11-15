'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MapSystemNode } from '@/lib/map/loadMap';
import {
  systemNotificationLoadSchema,
  type Envelope,
  type SystemNotificationLoad,
} from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine } from '@/lib/sounds/engine';
import type { SoundEvent } from '@/types';
import { shouldPlaySystemSound, useExperimentalSoundGate } from './ExperimentalSoundGate';

const CUE_FOR_KIND: Record<SystemNotificationLoad['kind'], SoundEvent> = {
  killmail: 'killInSystem',
  ping: 'systemPinged',
};

/**
 * Turns a `systemNotification` on an on-map system into its cue: a zKB kill
 * sounds `killInSystem`, a ping sounds `systemPinged` (the pinger hears their
 * own echo). Renders nothing; the engine drops whichever of the two the
 * account has off.
 */
export function SystemNotificationSoundBridge({
  mapId,
  systems,
}: {
  mapId: string;
  systems: MapSystemNode[];
}) {
  const soundGate = useExperimentalSoundGate();
  const systemsRef = useRef(systems);
  useEffect(() => {
    systemsRef.current = systems;
  });

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'systemNotification') return;
        const parsed = systemNotificationLoadSchema.safeParse(envelope.load);
        if (!parsed.success) return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports.
        if (parsed.data.mapId !== Number(mapId)) return;
        // The server's system-to-map index can trail a removal, so a system
        // this map no longer shows stays silent, as its underglow does.
        const { systemId } = parsed.data;
        const row = systemsRef.current.find((s) => s.systemId === systemId);
        if (!row) return;
        const event = CUE_FOR_KIND[parsed.data.kind];
        if (!shouldPlaySystemSound(soundGate, row.id, event)) return;

        getSoundEngine().play(event);
      },
      [mapId, soundGate],
    ),
  );

  return null;
}
