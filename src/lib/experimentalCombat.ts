/** Combat ring stays visible this long after the last on-map kill (experimental). */
import { DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES } from '@/lib/experimentalCombatRingDuration';

/** Default ring length in ms when no device pref is available (SSR / tests). */
export const COMBAT_RING_MS = DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES * 60 * 1000;
