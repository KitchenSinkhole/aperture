import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES,
  clampExperimentalCombatRingMinutes,
  readExperimentalCombatRingMs,
} from '@/lib/experimentalCombatRingDuration';

describe('clampExperimentalCombatRingMinutes', () => {
  it('defaults non-finite input', () => {
    expect(clampExperimentalCombatRingMinutes(Number.NaN)).toBe(
      DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES,
    );
  });

  it('clamps to 0..60', () => {
    expect(clampExperimentalCombatRingMinutes(-1)).toBe(0);
    expect(clampExperimentalCombatRingMinutes(999)).toBe(60);
  });
});

describe('readExperimentalCombatRingMs', () => {
  it('converts default minutes to ms', () => {
    expect(readExperimentalCombatRingMs()).toBe(DEFAULT_EXPERIMENTAL_COMBAT_RING_MINUTES * 60_000);
  });
});