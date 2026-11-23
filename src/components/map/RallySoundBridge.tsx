'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MapSystemNode } from '@/lib/map/loadMap';
import { mapUpdateLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { getSoundEngine, useSoundPrefs } from '@/lib/sounds/engine';
import { shouldShowExperimentalAlertToast } from '@/lib/sounds/alertToast';
import { isExperimentalUiActive, readExperimentalUiFromHtml } from '@/lib/experimentalUi';
import { isCueMutedInSystem } from '@/lib/sounds/prefs';

/**
 * Turns a rally point being set on any system of the open map into the
 * `rallySet` cue. Renders nothing. Mounted only when the account has the event
 * enabled — when absent, no cue fires.
 *
 * With experimental UI, optional in-app toast and desktop notification use the
 * rally row prefs (`toast`, `desktopNotification`); the engine handles chimes
 * and upstream per-system mutes.
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

        const system = systemsRef.current.find((s) => s.id === payload.id);
        const name = payload.alias?.trim() || payload.tag?.trim() || `System ${payload.id}`;
        const cueSystem =
          system && {
            systemId: system.systemId,
            isHome: system.id === homeMapSystemId,
          };

        getSoundEngine().play('rallySet', cueSystem && { system: cueSystem });

        if (experimental && shouldShowExperimentalAlertToast(rallyPrefs)) {
          toast.message('Rally point set', { description: name });
        }
        if (
          experimental &&
          rallyPrefs.desktopNotification === true &&
          cueSystem &&
          !isCueMutedInSystem(prefs, 'rallySet', cueSystem) &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification('Rally point set', { body: name, tag: `rally-${payload.id}` });
          } catch {
            return;
          }
        }
      },
      [experimental, homeMapSystemId, mapId, prefs, rallyPrefs],
    ),
  );

  return null;
}