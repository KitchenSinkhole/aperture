// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ROUTE_MAX_FOLLOWERS,
  ACTIVE_ROUTE_MAX_HOPS,
  setMapActiveRouteInputSchema,
} from '@/lib/map/mapActiveRouteSchema';

describe('setMapActiveRouteInputSchema', () => {
  it('accepts a minimal valid active route payload', () => {
    const result = setMapActiveRouteInputSchema.safeParse({
      mapId: '1',
      primaryCharacterId: 42,
      destinationSystemId: 30000142,
      plan: {
        destinationSystemId: 30000142,
        destinationName: 'Jita',
        reachable: true,
        jumps: 1,
        hops: [
          {
            systemId: 30000142,
            name: 'Jita',
            security: '1.0',
            securityStatus: 1,
            via: 'origin',
            connectionId: null,
            onMap: true,
            tag: null,
            viaSigId: null,
          },
        ],
      },
      followerCharacterIds: [42],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty follower list', () => {
    const result = setMapActiveRouteInputSchema.safeParse({
      mapId: '1',
      primaryCharacterId: 42,
      destinationSystemId: 30000142,
      plan: { hops: [] },
      followerCharacterIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects plans exceeding hop cap', () => {
    const hop = {
      systemId: 30000142,
      name: 'Jita',
      security: '1.0',
      securityStatus: 1,
      via: 'origin' as const,
      connectionId: null,
      onMap: true,
      tag: null,
      viaSigId: null,
    };
    const result = setMapActiveRouteInputSchema.safeParse({
      mapId: '1',
      primaryCharacterId: 42,
      destinationSystemId: 30000142,
      plan: {
        destinationSystemId: 30000142,
        destinationName: 'Jita',
        reachable: true,
        jumps: ACTIVE_ROUTE_MAX_HOPS + 1,
        hops: Array.from({ length: ACTIVE_ROUTE_MAX_HOPS + 1 }, () => hop),
      },
      followerCharacterIds: [42],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric map id', () => {
    const result = setMapActiveRouteInputSchema.safeParse({
      mapId: 'not-a-number',
      primaryCharacterId: 42,
      destinationSystemId: 30000142,
      plan: {
        destinationSystemId: 30000142,
        destinationName: 'Jita',
        reachable: true,
        jumps: 1,
        hops: [],
      },
      followerCharacterIds: [42],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when plan destination disagrees with top-level destination', () => {
    const result = setMapActiveRouteInputSchema.safeParse({
      mapId: '1',
      primaryCharacterId: 42,
      destinationSystemId: 30000142,
      plan: {
        destinationSystemId: 30002187,
        destinationName: 'Amarr',
        reachable: true,
        jumps: 1,
        hops: [],
      },
      followerCharacterIds: [42],
    });
    expect(result.success).toBe(false);
  });

  it('rejects too many followers', () => {
    const result = setMapActiveRouteInputSchema.safeParse({
      mapId: '1',
      primaryCharacterId: 42,
      destinationSystemId: 30000142,
      plan: {
        destinationSystemId: 30000142,
        destinationName: 'Jita',
        reachable: true,
        jumps: 1,
        hops: [
          {
            systemId: 30000142,
            name: 'Jita',
            security: '1.0',
            securityStatus: 1,
            via: 'origin',
            connectionId: null,
            onMap: true,
            tag: null,
            viaSigId: null,
          },
        ],
      },
      followerCharacterIds: Array.from(
        { length: ACTIVE_ROUTE_MAX_FOLLOWERS + 1 },
        (_, i) => i + 1,
      ),
    });
    expect(result.success).toBe(false);
  });
});
