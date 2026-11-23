// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { boundWormholeCode } from '@/lib/map/connectionDeathSnapshot';

describe('boundWormholeCode', () => {
  it('returns the single non-K162 code, ignoring a K162 on the far end', () => {
    expect(boundWormholeCode(['O477', 'K162'])).toBe('O477');
    expect(boundWormholeCode(['O477', 'O477'])).toBe('O477');
  });

  it('returns K162 when only K162 is bound', () => {
    expect(boundWormholeCode(['K162', 'K162'])).toBe('K162');
  });

  it('returns null when nothing typed is bound or the real codes disagree', () => {
    expect(boundWormholeCode([])).toBeNull();
    expect(boundWormholeCode(['O477', 'B274'])).toBeNull();
    expect(boundWormholeCode(['O477', 'B274', 'K162'])).toBeNull();
  });
});
