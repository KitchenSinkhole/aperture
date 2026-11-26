/** Device-local combat ring duration for the experimental UI (minutes; 0 = off). */

export const EXPERIMENTAL_COMBAT_RING_MINUTES_KEY = 'aperture:experimental:combat-ring-minutes';

export const DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES = 10;

export const EXPERIMENTAL_COMBAT_RING_MIN_MINUTES = 0;
export const EXPERIMENTAL_COMBAT_RING_MAX_MINUTES = 60;

export function clampExperimentalCombatRingMinutes(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES;
  return Math.min(
    EXPERIMENTAL_COMBAT_RING_MAX_MINUTES,
    Math.max(EXPERIMENTAL_COMBAT_RING_MIN_MINUTES, Math.round(raw)),
  );
}

export function readExperimentalCombatRingMinutes(): number {
  if (typeof window === 'undefined') return DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES;
  try {
    const raw = localStorage.getItem(EXPERIMENTAL_COMBAT_RING_MINUTES_KEY);
    if (raw === null || raw === '') return DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES;
    return clampExperimentalCombatRingMinutes(Number(raw));
  } catch {
    return DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES;
  }
}

export function readExperimentalCombatRingMs(): number {
  const minutes = readExperimentalCombatRingMinutes();
  if (minutes <= 0) return 0;
  return minutes * 60 * 1000;
}

export function writeExperimentalCombatRingMinutes(minutes: number): void {
  const clamped = clampExperimentalCombatRingMinutes(minutes);
  try {
    localStorage.setItem(EXPERIMENTAL_COMBAT_RING_MINUTES_KEY, String(clamped));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-combat-ring-duration'));
}