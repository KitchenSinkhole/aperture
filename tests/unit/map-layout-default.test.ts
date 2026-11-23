// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_LAYOUT,
  EXPERIMENTAL_DEFAULT_MAP_LAYOUT,
  defaultMapLayoutForUi,
} from '@/lib/map/layout/panels';

describe('defaultMapLayoutForUi', () => {
  it('returns the standard default when experimental is off', () => {
    expect(defaultMapLayoutForUi(false)).toBe(DEFAULT_MAP_LAYOUT);
  });

  it('returns the experimental default when experimental is on', () => {
    expect(defaultMapLayoutForUi(true)).toBe(EXPERIMENTAL_DEFAULT_MAP_LAYOUT);
  });

  it('groups the right column tab strips while keeping the legacy default untouched', () => {
    const inspector = EXPERIMENTAL_DEFAULT_MAP_LAYOUT.groups.lg.find((g) => g.id === 'inspector');
    expect(inspector?.members).toEqual(['inspector', 'intel']);
    const route = EXPERIMENTAL_DEFAULT_MAP_LAYOUT.groups.lg.find((g) => g.id === 'route');
    expect(route?.members).toContain('currentRoute');
    const thera = EXPERIMENTAL_DEFAULT_MAP_LAYOUT.groups.lg.find((g) => g.id === 'thera');
    expect(thera?.members).toContain('dscan');
    expect(EXPERIMENTAL_DEFAULT_MAP_LAYOUT.layouts.lg.find((i) => i.i === 'signatures')?.h).toBe(4);
    expect(DEFAULT_MAP_LAYOUT.layouts.lg.find((i) => i.i === 'signatures')?.h).toBe(6);
  });
});
