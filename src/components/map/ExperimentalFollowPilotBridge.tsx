'use client';

import { useEffect, useRef } from 'react';
import { useMapActiveChar } from './MapActiveCharContext';
import { useTraversals } from './MapPresenceContext';
import type { MapSystemNode } from '@/lib/map/loadMap';

/**
 * Experimental: when follow is on, refocus the map on the selected pilot's jump target.
 */
export function ExperimentalFollowPilotBridge({
  enabled,
  focusEveSystemId,
  systems,
}: {
  enabled: boolean;
  focusEveSystemId: (eveSystemId: number) => void;
  systems: readonly MapSystemNode[];
}) {
  const { pickedCharId, activeCharId } = useMapActiveChar();
  const followCharId = pickedCharId ?? activeCharId;
  const systemsRef = useRef(systems);
  useEffect(() => {
    systemsRef.current = systems;
  });

  useTraversals((t) => {
    if (!enabled || followCharId == null || t.characterId !== followCharId) return;
    if (!systemsRef.current.some((s) => s.systemId === t.toSystemId)) return;
    focusEveSystemId(t.toSystemId);
  });

  return null;
}
