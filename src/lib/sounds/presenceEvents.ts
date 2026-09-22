import type { SoundEvent } from './prefs';

/** The structural shape of `MapPresenceContext`'s `Traversal` this module reads. */
export type TraversalLike = {
  characterId: number;
  fromSystemId: number;
  toSystemId: number;
};

/**
 * Which cue (if any) a tracked pilot's jump earns, relative to the system the
 * viewer's active character sits in.
 */
export function classifyTraversal(
  t: TraversalLike,
  mySystemId: number | null,
  viewerCharacterIds: ReadonlySet<number>,
): Extract<SoundEvent, 'pilotArrived' | 'pilotLeft'> | null {
  if (mySystemId === null) return null;
  if (viewerCharacterIds.has(t.characterId)) return null;
  if (t.toSystemId === mySystemId) return 'pilotArrived';
  if (t.fromSystemId === mySystemId) return 'pilotLeft';
  return null;
}
