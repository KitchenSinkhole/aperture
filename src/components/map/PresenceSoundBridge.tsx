'use client';

import { useMemo } from 'react';
import { getSoundEngine } from '@/lib/sounds/engine';
import { classifyTraversal } from '@/lib/sounds/presenceEvents';
import { useMapActiveChar } from './MapActiveCharContext';
import { usePresenceStore, useTraversals } from './MapPresenceContext';

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
 */
export function PresenceSoundBridge({ viewerCharacterIds }: { viewerCharacterIds: number[] }) {
  const { activeCharId } = useMapActiveChar();
  const store = usePresenceStore();
  const viewerIds = useMemo(() => new Set(viewerCharacterIds), [viewerCharacterIds]);

  useTraversals((t) => {
    const mySystemId = activeCharId === null ? null : store?.getSystemForCharacter(activeCharId);
    const event = classifyTraversal(t, mySystemId ?? null, viewerIds);
    if (!event) return;
    getSoundEngine().play(event);
  });

  return null;
}
