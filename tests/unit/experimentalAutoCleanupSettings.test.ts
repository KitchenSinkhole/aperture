import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_AUTO_CLEANUP,
  mergeExperimentalAutoCleanupIntoNextBookmarks,
  parseExperimentalAutoCleanupFromNextBookmarks,
} from '@/lib/map/experimentalAutoCleanupSettings';

describe('experimentalAutoCleanupSettings', () => {
  it('defaults off for legacy bookmark arrays', () => {
    expect(parseExperimentalAutoCleanupFromNextBookmarks([])).toEqual(
      DEFAULT_EXPERIMENTAL_AUTO_CLEANUP,
    );
  });

  it('reads flags from experimentalAutoCleanup object', () => {
    const raw = {
      bookmarks: [],
      experimentalAutoCleanup: { signatureCleanup: true, mapCleanup: false },
    };
    expect(parseExperimentalAutoCleanupFromNextBookmarks(raw)).toEqual({
      autoSignatureCleanup: true,
      autoMapCleanup: false,
    });
  });

  it('merges without dropping unrelated keys', () => {
    const raw = { bookmarks: [{ id: 1 }], other: true };
    const merged = mergeExperimentalAutoCleanupIntoNextBookmarks(raw, {
      autoMapCleanup: true,
    }) as { bookmarks: unknown[]; other: boolean; experimentalAutoCleanup: unknown };
    expect(merged.bookmarks).toEqual([{ id: 1 }]);
    expect(merged.other).toBe(true);
    expect(merged.experimentalAutoCleanup).toEqual({
      signatureCleanup: false,
      mapCleanup: true,
    });
  });
});