import { describe, it, expect } from 'vitest';
import { effectiveBookmarkScheme } from '@/lib/bookmarking/scheme';
import { referenceScheme } from '@/lib/bookmarking/reference';
import localOverride from '#bookmark-local';

// Pure test for the weak-default resolution. No db.

describe('effectiveBookmarkScheme', () => {
  it.skipIf(localOverride !== null)(
    'falls back to referenceScheme when no local override is present',
    () => {
      expect(effectiveBookmarkScheme).toBe(referenceScheme);
    },
  );
});
