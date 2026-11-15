import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fightTaggedSystems,
  resolveHomeFightRouteEnds,
  writeExperimentalFightMapSystemId,
} from '@/lib/experimentalRoutePrefs';
import type { MapSystemNode } from '@/types';

vi.mock('@/lib/experimentalUi', () => ({
  readExperimentalUiFromHtml: () => 'aperture',
  isExperimentalUiActive: () => true,
}));

const sys = (id: string, tag?: string, alias?: string): MapSystemNode =>
  ({
    id,
    mapId: '1',
    systemId: 1,
    name: id,
    alias: alias ?? null,
    tag: tag ?? null,
    status: 'active',
    locked: false,
    visible: true,
    rallyAt: null,
    x: 0,
    y: 0,
  }) as unknown as MapSystemNode;

describe('experimentalRoutePrefs fight', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('explicit Set fight id wins over /fight/i tag inference', () => {
    const tagged = sys('tagged', 'staging-fight');
    const explicit = sys('explicit', 'quiet');
    writeExperimentalFightMapSystemId(explicit.id);
    const ends = resolveHomeFightRouteEnds([tagged, explicit], null);
    expect(ends.fight?.id).toBe('explicit');
  });

  it('falls back to fight-tagged systems when no explicit id', () => {
    const other = sys('other');
    const tagged = sys('tagged', 'go-fight');
    expect(fightTaggedSystems([other, tagged]).map((s) => s.id)).toEqual(['tagged']);
    const ends = resolveHomeFightRouteEnds([other, tagged], null);
    expect(ends.fight?.id).toBe('tagged');
  });
});