'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { mapUpdateLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine, useSoundPrefs } from '@/lib/sounds/engine';
import { isExperimentalUiActive, readExperimentalUiFromHtml } from '@/lib/experimentalUi';
import { shouldPlaySystemSound, useExperimentalSoundGate } from './ExperimentalSoundGate';

/**
 * Turns a rally point being set on any system of the open map into the
 * `rallySet` cue. With experimental UI, also surfaces an in-app toast and an
 * optional desktop notification from the rally row prefs. Renders nothing.
 */
export function RallySoundBridge({ mapId }: { mapId: string }) {
  const soundGate = useExperimentalSoundGate();
  const prefs = useSoundPrefs();
  const rallyPrefs = prefs.events.rallySet;
  const experimental = isExperimentalUiActive(readExperimentalUiFromHtml());

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (envelope.task !== 'mapUpdate') return;
        const parsed = mapUpdateLoadSchema.safeParse(envelope.load);
        if (!parsed.success || parsed.data.mapId !== Number(mapId)) return;
        const payload = parsed.data.data;
        if (payload?.kind !== 'system.updated' || payload.rallyAt == null) return;
        if (!shouldPlaySystemSound(soundGate, payload.id, 'rallySet')) return;

        const name = payload.alias?.trim() || payload.tag?.trim() || `System ${payload.id}`;
        getSoundEngine().play('rallySet');
        if (experimental) {
          toast.message('Rally point set', { description: name });
          if (
            rallyPrefs.desktopNotification === true &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted'
          ) {
            try {
              new Notification('Rally point set', { body: name, tag: `rally-${payload.id}` });
            } catch {
              return;
            }
          }
        }
      },
      [experimental, mapId, rallyPrefs.desktopNotification, soundGate],
    ),
  );

  return null;
}