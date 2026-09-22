'use client';

import { useCallback } from 'react';
import { systemNotificationLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine } from '@/lib/sounds/engine';

/**
 * Turns a zKB kill in an on-map system into the `killInSystem` cue, alongside
 * the red underglow `MapUnderglowBridge` draws from the same envelope. Renders
 * nothing. Mounted only when the account has the event enabled — when absent,
 * no cue fires.
 *
 * The server fans a `systemNotification` only to maps that hold the system, so
 * membership needs no resolution here. A `ping` rides the same task and is not
 * a kill, so only `kind === 'killmail'` sounds.
 */
export function KillSoundBridge({ mapId }: { mapId: string }) {
  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'systemNotification') return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports; a foreign mapId here would mean a
        // worker routing regression, not a kill on the open map.
        if (envelope.mapId != null && envelope.mapId !== Number(mapId)) return;
        const parsed = systemNotificationLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.kind !== 'killmail') return;

        getSoundEngine().play('killInSystem');
      },
      [mapId],
    ),
  );

  return null;
}
