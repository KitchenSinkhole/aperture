import type { SoundEvent, SoundVariant } from './prefs';

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

/**
 * Which watched-jump cue variant a jump earns, relative to the system the
 * viewer's active character sits in: `inbound` when the jump ends there,
 * `outbound` when it starts there, `plain` when the viewer sits elsewhere or
 * nowhere. Built-in chimes ignore the variant; the voice pack uses it.
 */
export function watchedJumpVariant(
  t: Pick<TraversalLike, 'fromSystemId' | 'toSystemId'>,
  mySystemId: number | null,
): SoundVariant {
  if (mySystemId === null) return 'plain';
  if (t.toSystemId === mySystemId) return 'inbound';
  if (t.fromSystemId === mySystemId) return 'outbound';
  return 'plain';
}
