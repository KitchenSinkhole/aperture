'use client';

import { useCallback } from 'react';
import { systemNotificationLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine } from '@/lib/sounds/engine';

/**
 * Turns a system ping into the `systemPinged` cue, alongside the blue
 * underglow `MapUnderglowBridge` draws from the same envelope. Renders
 * nothing. Mounted only when the account has the event enabled — when absent,
 * no cue fires.
 *
 * The pinger receives its own echo, so they hear the cue too.
 */
export function PingSoundBridge({ mapId }: { mapId: string }) {
  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'systemNotification') return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports.
        if (envelope.mapId != null && envelope.mapId !== Number(mapId)) return;
        const parsed = systemNotificationLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.kind !== 'ping') return;

        getSoundEngine().play('systemPinged');
      },
      [mapId],
    ),
  );

  return null;
}
