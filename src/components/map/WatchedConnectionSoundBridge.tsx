'use client';

import { useEffect, useMemo, useRef } from 'react';
import { isConnectionWatched } from '@/lib/connectionWatchPrefs';
import type { MapConnectionEdge, MapSystemNode } from '@/lib/map/loadMap';
import { getSoundEngine } from '@/lib/sounds/engine';
import { watchedJumpVariant } from '@/lib/sounds/presenceEvents';
import { useMapActiveChar } from './MapActiveCharContext';
import { usePresenceStore, useTraversals } from './MapPresenceContext';
import { resolveTraversalEdges } from './MapTravelContext';

/**
 * Turns a tracked pilot's jump through a watched wormhole into the
 * `watchedJump` cue. Renders nothing. Mounted only when the account has the
 * event enabled — when absent, no cue fires. Lives inside both
 * `MapPresenceProvider` and `MapActiveCharProvider`.
 *
 * The variant is relative to where the viewer is sitting, so it reads the
 * system from the presence store at event time rather than from render-scoped
 * state: a traversal fires synchronously from inside `PresenceStore.apply()`,
 * so a same-frame burst is classified before React re-renders and any rendered
 * copy of the viewer's system is a commit behind. Only the active character id,
 * which a jump never changes, comes from the active-char context.
 */
export function WatchedConnectionSoundBridge({
  mapId,
  systems,
  connections,
  viewerCharacterIds,
}: {
  mapId: string;
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  viewerCharacterIds: number[];
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
    if (viewerIds.has(t.characterId)) return;
    const edges = resolveTraversalEdges(t, systemsRef.current, connectionsRef.current);
    if (!edges.some((e) => isConnectionWatched(mapId, e.connectionId))) return;
    const mySystemId =
      activeCharId === null ? null : (store?.getSystemForCharacter(activeCharId) ?? null);
    getSoundEngine().play('watchedJump', { variant: watchedJumpVariant(t, mySystemId) });
  });

  return null;
}
