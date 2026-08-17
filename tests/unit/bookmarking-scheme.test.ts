import { describe, it, expect } from 'vitest';
import { effectiveBookmarkScheme } from '@/lib/bookmarking/scheme';
import { referenceScheme } from '@/lib/bookmarking/reference';

// Pure test for the weak-default resolution. No db.

describe('effectiveBookmarkScheme', () => {
  it('falls back to referenceScheme when no local override is present', () => {
    expect(effectiveBookmarkScheme).toBe(referenceScheme);
  });
});
