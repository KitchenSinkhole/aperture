// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  connectionStyle,
  homeAccentColor,
  systemClassColor,
  systemStatusColor,
} from '@/components/map/styling';

describe('map styling default palette', () => {
  it('matches historical hex values when palette is default', () => {
    expect(systemClassColor('H')).toBe('#22c55e');
    expect(systemClassColor('C6')).toBe('#ea580c');
    expect(systemStatusColor('hostile')).toBe('#ef4444');
    expect(homeAccentColor()).toBe('#fbbf24');
    expect(connectionStyle({ scope: 'wh', massStatus: 'fresh', jumpMassClass: null, eolStage: 'none' }).stroke).toBe(
      '#84cc16',
    );
  });

  it('uses experimental dark hues when palette is experimental', () => {
    expect(systemClassColor('H', { palette: 'experimental', theme: 'dark' })).toBe('#3DDC97');
    expect(systemStatusColor('hostile', { palette: 'experimental', theme: 'dark' })).toBe('#FF5C5C');
    expect(
      connectionStyle(
        { scope: 'wh', massStatus: 'critical', jumpMassClass: 'm', eolStage: 'none' },
        { palette: 'experimental', theme: 'dark' },
      ).stroke,
    ).toBe('#FF5C5C');
  });
});
