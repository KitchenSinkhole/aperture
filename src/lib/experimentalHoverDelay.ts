/** Device-local hover timing for the experimental UI (legacy UI ignores this). */

export const EXPERIMENTAL_HOVER_DELAY_KEY = 'aperture:experimental:hover-delay-ms';

export const DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS = 100;

export const EXPERIMENTAL_HOVER_DELAY_MIN_MS = 0;
export const EXPERIMENTAL_HOVER_DELAY_MAX_MS = 2000;

export function clampExperimentalHoverDelayMs(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS;
  return Math.min(
    EXPERIMENTAL_HOVER_DELAY_MAX_MS,
    Math.max(EXPERIMENTAL_HOVER_DELAY_MIN_MS, Math.round(raw)),
  );
}

export function readExperimentalHoverDelayMs(): number {
  if (typeof window === 'undefined') return DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS;
  try {
    const raw = localStorage.getItem(EXPERIMENTAL_HOVER_DELAY_KEY);
    if (raw === null || raw === '') return DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS;
    return clampExperimentalHoverDelayMs(Number(raw));
  } catch {
    return DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS;
  }
}

export function writeExperimentalHoverDelayMs(ms: number): void {
  const clamped = clampExperimentalHoverDelayMs(ms);
  try {
    localStorage.setItem(EXPERIMENTAL_HOVER_DELAY_KEY, String(clamped));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent('aperture:experimental-hover-delay'));
}
