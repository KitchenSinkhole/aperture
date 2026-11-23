// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldSyncSignatureDraft } from '@/lib/map/signatureDraftSync';

describe('shouldSyncSignatureDraft', () => {
  it.each([
    ['', false],
    ['  ', false],
    ['ABC', true],
  ] as const)('sigId %j → %s', (sigId, expected) => {
    expect(shouldSyncSignatureDraft(sigId)).toBe(expected);
  });
});
