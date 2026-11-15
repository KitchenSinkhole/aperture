import { describe, expect, it } from 'vitest';
import { shouldMapFitOnFKey } from '@/components/map/MapCommandPalette';

describe('shouldMapFitOnFKey', () => {
  it('fits on bare f when not blocked', () => {
    expect(
      shouldMapFitOnFKey({ key: 'f', metaKey: false, ctrlKey: false, altKey: false }, false),
    ).toBe(true);
  });

  it('does not fit when blockFitKey is set (link selected)', () => {
    expect(
      shouldMapFitOnFKey({ key: 'f', metaKey: false, ctrlKey: false, altKey: false }, true),
    ).toBe(false);
  });
});