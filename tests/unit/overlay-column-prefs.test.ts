import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_OVERLAY_COLUMN_PX, MIN_OVERLAY_COLUMN_PX } from '@/lib/map/overlayColumnFit';
import {
  OVERLAY_COLUMN_WIDTHS_KEY,
  readOverlayColumnWidths,
  writeOverlayColumnWidths,
} from '@/lib/map/overlayColumnPrefs';

describe('overlay column widths storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a stored pair of widths', () => {
    writeOverlayColumnWidths({ pilot: 140, name: 90 });
    expect(readOverlayColumnWidths()).toEqual({ pilot: 140, name: 90 });
  });

  it('reads null when nothing is stored', () => {
    expect(readOverlayColumnWidths()).toBeNull();
  });

  it('reads null for unparseable storage', () => {
    localStorage.setItem(OVERLAY_COLUMN_WIDTHS_KEY, 'not json');
    expect(readOverlayColumnWidths()).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['below the floor', MIN_OVERLAY_COLUMN_PX - 1],
    ['above the ceiling', MAX_OVERLAY_COLUMN_PX + 1],
    ['not a number', 'wide'],
  ])('rejects a %s width on read', (_label, pilot) => {
    localStorage.setItem(OVERLAY_COLUMN_WIDTHS_KEY, JSON.stringify({ pilot, name: 90 }));
    expect(readOverlayColumnWidths()).toBeNull();
  });

  it('refuses to store an out-of-range width', () => {
    writeOverlayColumnWidths({ pilot: 0, name: 90 });
    expect(localStorage.getItem(OVERLAY_COLUMN_WIDTHS_KEY)).toBeNull();
  });
});
