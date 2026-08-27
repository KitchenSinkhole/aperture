'use client';

/**
 * Remembered size of the Document Picture-in-Picture overlay window. Client-only,
 * persisted to localStorage as a single JSON blob — the PiP window is torn down
 * and recreated on every open, so storage is the only place a size survives.
 *
 * Dimensions are the window's **outer** size, the units `Window.resizeTo` takes,
 * so a restored size needs no conversion. The PiP title bar makes outer height
 * roughly 98px larger than the viewport.
 */

export const PIP_WINDOW_SIZE_KEY = 'aperture:pip-window-size';

/** Outer window dimensions, as `Window.resizeTo` accepts them. */
export type PipWindowSize = { width: number; height: number };

export const DEFAULT_PIP_WINDOW_SIZE: PipWindowSize = { width: 260, height: 320 };

// A closing PiP window reports its dimensions as 0, and Chromium answers a 0 or
// out-of-range request by substituting its own default size — so a dimension
// outside these bounds must never be stored or replayed.
const MIN_PIP_DIMENSION = 120;
const MAX_PIP_DIMENSION = 4000;

function isValidDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_PIP_DIMENSION &&
    value <= MAX_PIP_DIMENSION
  );
}

/** The stored overlay size, or null when nothing usable is stored. */
export function readPipWindowSize(): PipWindowSize | null {
  try {
    const raw = localStorage.getItem(PIP_WINDOW_SIZE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { width, height } = parsed as Partial<PipWindowSize>;
    if (!isValidDimension(width) || !isValidDimension(height)) return null;
    return { width, height };
  } catch {
    return null;
  }
}

/** Persist the overlay size. A dimension outside the valid range is discarded. */
export function writePipWindowSize(size: PipWindowSize): void {
  if (!isValidDimension(size.width) || !isValidDimension(size.height)) return;
  try {
    localStorage.setItem(PIP_WINDOW_SIZE_KEY, JSON.stringify(size));
  } catch {
    // Storage unavailable (private browsing, quota) — the size just won't persist.
  }
}
