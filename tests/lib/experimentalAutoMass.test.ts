import { describe, expect, it } from 'vitest';
import { massStatusFromCumulative, massStatusFromRemainingPercent } from '@/lib/experimentalAutoMass';

describe('experimentalAutoMass', () => {
  it('bands remaining percent', () => {
    expect(massStatusFromRemainingPercent(80)).toBe('fresh');
    expect(massStatusFromRemainingPercent(40)).toBe('reduced');
    expect(massStatusFromRemainingPercent(5)).toBe('critical');
  });

  it('derives from cumulative', () => {
    expect(massStatusFromCumulative(600_000_000, 1_000_000_000)).toBe('reduced');
    expect(massStatusFromCumulative(50_000, null)).toBeNull();
  });
});
