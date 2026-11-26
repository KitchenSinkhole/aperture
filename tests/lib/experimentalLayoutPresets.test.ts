import { describe, expect, it } from 'vitest';
import { experimentalLayoutPreset } from '@/lib/experimentalLayoutPresets';
import { PANELS } from '@/lib/map/layout/panels';

describe('experimentalLayoutPresets', () => {
  it('scanning keeps Signatures and Inspector visible, hides other panels', () => {
    const layout = experimentalLayoutPreset('scanning');
    expect(layout.hidden).not.toContain('signatures');
    expect(layout.hidden).not.toContain('inspector');
    expect(layout.hidden).toContain('route');
    expect(layout.hidden).toContain('pilots');
    expect(layout.layouts.lg.find((i) => i.i === 'signatures')?.h).toBe(14);
  });

  it('combat focuses pilots and kills', () => {
    const layout = experimentalLayoutPreset('combat');
    expect(layout.hidden).not.toContain('pilots');
    expect(layout.hidden).not.toContain('kills');
    expect(layout.hidden).toContain('signatures');
    expect(layout.layouts.lg.find((i) => i.i === 'canvas')?.h).toBe(18);
  });

  it('travel focuses route tab group', () => {
    const layout = experimentalLayoutPreset('travel');
    expect(layout.hidden).not.toContain('route');
    expect(layout.hidden).not.toContain('currentRoute');
    for (const p of PANELS) {
      if (p.id === 'canvas' || p.id === 'route' || p.id === 'currentRoute') continue;
      expect(layout.hidden).toContain(p.id);
    }
  });
});