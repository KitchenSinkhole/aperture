'use client';

import { MAX_OVERLAY_COLUMN_PX, MIN_OVERLAY_COLUMN_PX } from './overlayColumnFit';

/**
 * Remembered widths of the system overlay's resizable pilot columns. Client-only,
 * persisted to localStorage as a single JSON blob — the overlay lives in a
 * Document PiP window that is torn down and recreated on every open, so storage
 * is the only place a width survives.
 *
 * Only the two leading columns are stored. The trailing `type` column takes
 * whatever width is left over, which is what lets a wider window widen it.
 */

export const OVERLAY_COLUMN_WIDTHS_KEY = 'aperture:overlay-column-widths';

/** Widths of the two leading pilot columns, in CSS px. */
export type OverlayColumnWidths = { pilot: number; name: number };

export const DEFAULT_OVERLAY_COLUMN_WIDTHS: OverlayColumnWidths = { pilot: 92, name: 92 };

function isValidWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_OVERLAY_COLUMN_PX &&
    value <= MAX_OVERLAY_COLUMN_PX
  );
}

/** The stored column widths, or null when nothing usable is stored. */
export function readOverlayColumnWidths(): OverlayColumnWidths | null {
  try {
    const raw = localStorage.getItem(OVERLAY_COLUMN_WIDTHS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { pilot, name } = parsed as Partial<OverlayColumnWidths>;
    if (!isValidWidth(pilot) || !isValidWidth(name)) return null;
    return { pilot, name };
  } catch {
    return null;
  }
}

/** Persist the column widths. A width outside the valid range is discarded. */
export function writeOverlayColumnWidths(widths: OverlayColumnWidths): void {
  if (!isValidWidth(widths.pilot) || !isValidWidth(widths.name)) return;
  try {
    localStorage.setItem(OVERLAY_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // Storage unavailable (private browsing, quota) — the widths just won't persist.
  }
}
