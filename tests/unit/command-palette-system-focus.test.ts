import { describe, expect, it } from 'vitest';
import type { MapSystemNode } from '@/lib/map/loadMap';
import { matchSystemsForFocus } from '@/lib/map/commandPaletteSystemFocus';

const node = (overrides: Partial<MapSystemNode> & Pick<MapSystemNode, 'id' | 'name'>): MapSystemNode => {
  const { id, name, systemId, ...rest } = overrides;
  return {
    intelNotes: null,
    status: 'unknown',
    security: 'C2',
    trueSec: null,
    effect: null,
    regionName: 'Test',
    constellationName: 'Test',
    statics: [],
    staticTypeIds: [],
    tradeHub: null,
    locked: false,
    lockedByCharacterId: null,
    lockedByName: null,
    rallyAt: null,
    positionX: 0,
    positionY: 0,
    alias: null,
    tag: null,
    ...rest,
    id,
    name,
    systemId: systemId ?? 30_000_000 + Number(id),
  } as MapSystemNode;
};

describe('matchSystemsForFocus', () => {
  const systems = [
    node({ id: '1', name: 'J145335', tag: '1' }),
    node({ id: '2', name: 'J100001', tag: '11' }),
    node({ id: '3', name: 'J100002', tag: '113' }),
    node({ id: '4', name: 'J100003', alias: 'Cube' }),
    node({ id: '5', name: 'J100004', alias: 'Florida', tag: 'FL' }),
  ];

  it('ranks exact tag before name prefix and avoids substring tag false positives', () => {
    const forOne = matchSystemsForFocus(systems, '1');
    expect(forOne.map((m) => m.system.id)).toEqual(['1']);
    expect(forOne[0]?.rank).toBe('exact-tag');

    const forEleven = matchSystemsForFocus(systems, '11');
    expect(forEleven.map((m) => m.system.id)).toEqual(['2']);

    const for113 = matchSystemsForFocus(systems, '113');
    expect(for113.map((m) => m.system.id)).toEqual(['3']);
  });

  it('matches name and alias by prefix', () => {
    const j145 = matchSystemsForFocus(systems, 'J145');
    expect(j145.some((m) => m.system.id === '1' && m.rank === 'name-prefix')).toBe(true);

    const cube = matchSystemsForFocus(systems, 'Cub');
    expect(cube.map((m) => m.system.id)).toEqual(['4']);

    const flor = matchSystemsForFocus(systems, 'Flor');
    expect(flor.map((m) => m.system.id)).toEqual(['5']);
  });

  it('returns empty for blank query', () => {
    expect(matchSystemsForFocus(systems, '   ')).toEqual([]);
  });
});
