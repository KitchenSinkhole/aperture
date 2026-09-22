'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { MapConnectionEdge, MapSystemNode } from '@/lib/map/loadMap';
import { getSoundEngine } from '@/lib/sounds/engine';
import { classifyTraversal } from '@/lib/sounds/presenceEvents';
import { useMapActiveChar } from './MapActiveCharContext';
import { usePresenceStore, useTraversals } from './MapPresenceContext';
import { crossesWatchedConnection } from './WatchedConnectionSoundBridge';

/**
 * Turns pilot jumps into arrive/leave cues. Renders nothing. Mounted only when
 * the account has one of the two events enabled — when absent, no cue fires.
 * Lives inside both `MapPresenceProvider` and `MapActiveCharProvider`.
 *
 * A traversal fires synchronously from inside `PresenceStore.apply()`, so every
 * envelope of a same-frame burst is classified before React re-renders. Reading
 * the viewer's system from render-scoped state would therefore classify the
 * second move of a frame against the system the viewer occupied before the
 * first. The store is authoritative the instant the traversal fires, so the
 * system is resolved from it at event time; only the active character id —
 * which a jump never changes — comes from the active-char context.
 *
 * With `watchedJumpOn`, a jump through a watched connection belongs to the
 * `watchedJump` cue alone, whose inbound/outbound variant already says it
 * touched the viewer's system; one jump never plays two cues.
 */
export function PresenceSoundBridge({
  mapId,
  systems,
  connections,
  viewerCharacterIds,
  watchedJumpOn,
}: {
  mapId: string;
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  viewerCharacterIds: number[];
  watchedJumpOn: boolean;
}) {
  const { activeCharId } = useMapActiveChar();
  const store = usePresenceStore();
  const viewerIds = useMemo(() => new Set(viewerCharacterIds), [viewerCharacterIds]);

  const systemsRef = useRef(systems);
  const connectionsRef = useRef(connections);
  useEffect(() => {
    systemsRef.current = systems;
    connectionsRef.current = connections;
  });

  useTraversals((t) => {
    const mySystemId = activeCharId === null ? null : store?.getSystemForCharacter(activeCharId);
    const event = classifyTraversal(t, mySystemId ?? null, viewerIds);
    if (!event) return;
    if (
      watchedJumpOn &&
      crossesWatchedConnection(t, mapId, systemsRef.current, connectionsRef.current)
    ) {
      return;
    }
    getSoundEngine().play(event);
  });

  return null;
}
