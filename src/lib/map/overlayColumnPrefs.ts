'use client';

import type { OverlayColumnFractions } from './overlayColumnFit';

/**
 * Remembered proportions of the system overlay's resizable pilot columns.
 * Client-only, persisted to localStorage as a single JSON blob — the overlay
 * lives in a Document PiP window that is torn down and recreated on every open,
 * so storage is the only place a layout survives.
 *
 * Widths are stored as fractions of the resizable pool (the table width less the
 * fixed icon column), never as pixels: the PiP window is freely resizable, and a
 * fraction is the only unit that survives being reopened at another size. Only
 * the two leading columns are stored — `type` takes the remainder, so its share
 * is implied by the other two.
 */

export const OVERLAY_COLUMN_WIDTHS_KEY = 'aperture:overlay-column-widths';

export const DEFAULT_OVERLAY_COLUMN_FRACTIONS: OverlayColumnFractions = {
  pilot: 0.38,
  name: 0.38,
};

function isValidFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1;
}

/** The stored fractions, or null when nothing usable is stored. */
export function readOverlayColumnFractions(): OverlayColumnFractions | null {
  try {
    const raw = localStorage.getItem(OVERLAY_COLUMN_WIDTHS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { pilot, name } = parsed as Partial<OverlayColumnFractions>;
    if (!isValidFraction(pilot) || !isValidFraction(name)) return null;
    // The trailing column has to be left a share of its own.
    if (pilot + name >= 1) return null;
    return { pilot, name };
  } catch {
    return null;
  }
}

/** Persist the column fractions. A blob that leaves `type` no room is discarded. */
export function writeOverlayColumnFractions(fractions: OverlayColumnFractions): void {
  if (!isValidFraction(fractions.pilot) || !isValidFraction(fractions.name)) return;
  if (fractions.pilot + fractions.name >= 1) return;
  try {
    localStorage.setItem(OVERLAY_COLUMN_WIDTHS_KEY, JSON.stringify(fractions));
  } catch {
    // Storage unavailable (private browsing, quota) — the layout just won't persist.
  }
}
