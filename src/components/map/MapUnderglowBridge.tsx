'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MapSystemNode } from '@/lib/map/loadMap';
import { systemNotificationLoadSchema, type Envelope } from '@/lib/realtime/protocol';
import { useRealtimeEvents } from '@/lib/realtime/useRealtime';
import { useUnderglowStore } from './MapUnderglowContext';
import { UNDERGLOW_PRESETS } from './underglowPresets';

// Listens for `systemNotification` realtime events and resolves each to a map
// node, then triggers that node's underglow with the kind's preset. Renders
// nothing. Mirrors `TravelBridge`: `systems` is read through a ref so the
// listener never churns when the systems array changes.
//
// Notifications are keyed by EVE solar-system id; the underglow store is keyed
// by `ap_map_system.id`, so we map the former to the latter via `systems`.

export function MapUnderglowBridge({
  systems,
  mapId,
}: {
  systems: MapSystemNode[];
  mapId: string;
}) {
  const systemsRef = useRef(systems);
  useEffect(() => {
    systemsRef.current = systems;
  });

  const store = useUnderglowStore();

  useRealtimeEvents(
    useCallback(
      (envelope: Envelope) => {
        if (!store || envelope.task !== 'systemNotification') return;
        // Belt-and-suspenders: the SharedWorker already routes map-scoped
        // envelopes only to subscribed ports; a foreign mapId here would mean
        // a worker routing regression, not a legitimate cross-map glow.
        if (envelope.mapId != null && envelope.mapId !== Number(mapId)) return;
        const parsed = systemNotificationLoadSchema.safeParse(envelope.load);
        if (!parsed.success) return;
        const load = parsed.data;

        const node = systemsRef.current.find((s) => s.systemId === load.systemId);
        if (!node) return;

        store.trigger(node.id, UNDERGLOW_PRESETS[load.kind]);
      },
      [store, mapId],
    ),
  );

  return null;
}
