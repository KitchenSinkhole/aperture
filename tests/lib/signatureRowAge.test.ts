import { describe, expect, it } from 'vitest';
import { signatureRowAgeClass, signatureRowAgeTier } from '@/lib/map/signatureRowAge';

describe('signatureRowAgeTier', () => {
  it('classifies ages', () => {
    const now = Date.now();
    expect(signatureRowAgeTier(new Date(now - 30 * 60 * 1000).toISOString(), now)).toBe('fresh');
    expect(signatureRowAgeTier(new Date(now - 3 * 60 * 60 * 1000).toISOString(), now)).toBe('warm');
    expect(signatureRowAgeTier(new Date(now - 12 * 60 * 60 * 1000).toISOString(), now)).toBe('stale');
    expect(signatureRowAgeClass('warm')).toBe('ap-sig-age-warm');
  });
});
