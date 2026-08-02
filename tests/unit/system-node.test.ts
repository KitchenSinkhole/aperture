import { describe, expect, it } from 'vitest';
import { staticCompare } from '@/lib/map/staticOrder';

describe('staticCompare', () => {
  it('orders wormhole statics by class number ascending', () => {
    expect(['C5', 'C3', 'C1'].sort(staticCompare)).toEqual(['C1', 'C3', 'C5']);
  });

  it('ranks wormholes ahead of k-space security labels', () => {
    expect(staticCompare('C6', 'H')).toBeLessThan(0);
  });

  it('orders k-space labels H < L < 0.0 < P', () => {
    expect(['P', '0.0', 'L', 'H'].sort(staticCompare)).toEqual(['H', 'L', '0.0', 'P']);
  });

  it('sorts unknown labels last', () => {
    expect(staticCompare('P', 'X')).toBeLessThan(0);
    expect(staticCompare('C1', 'X')).toBeLessThan(0);
  });

  it('returns 0 for equal ranks', () => {
    expect(staticCompare('C3', 'C3')).toBe(0);
    expect(staticCompare('H', 'H')).toBe(0);
  });

  it('sorts a mixed set of statics into display order', () => {
    expect(['P', 'C2', 'H', '0.0', 'C5'].sort(staticCompare)).toEqual([
      'C2',
      'C5',
      'H',
      '0.0',
      'P',
    ]);
  });
});
