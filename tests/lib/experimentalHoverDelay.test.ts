import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS,
  clampExperimentalHoverDelayMs,
} from '@/lib/experimentalHoverDelay';

describe('clampExperimentalHoverDelayMs', () => {
  it('defaults non-finite values', () => {
    expect(clampExperimentalHoverDelayMs(Number.NaN)).toBe(DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS);
  });

  it('clamps to min and max', () => {
    expect(clampExperimentalHoverDelayMs(-5)).toBe(0);
    expect(clampExperimentalHoverDelayMs(99999)).toBe(2000);
    expect(clampExperimentalHoverDelayMs(100.6)).toBe(101);
  });
});
