// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { kspaceWaypointSystemIds } from '@/lib/map/routeKspaceWaypoints';
import type { RouteHop } from '@/types';

const hop = (partial: Partial<RouteHop> & Pick<RouteHop, 'systemId' | 'via'>): RouteHop => ({
  name: 'X',
  security: null,
  securityStatus: 0.5,
  connectionId: null,
  onMap: true,
  tag: null,
  viaSigId: null,
  ...partial,
});

describe('kspaceWaypointSystemIds', () => {
  it('skips origin and wormhole-space hops', () => {
    const ids = kspaceWaypointSystemIds([
      hop({ systemId: 1, via: 'origin', securityStatus: 0.9 }),
      hop({ systemId: 2, via: 'gate', securityStatus: 0.4 }),
      hop({ systemId: 31000007, via: 'wh', securityStatus: -1 }),
      hop({ systemId: 3, via: 'gate', securityStatus: 0.2 }),
    ]);
    expect(ids).toEqual([2, 3]);
  });
});
