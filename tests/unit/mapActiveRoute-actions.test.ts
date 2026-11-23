// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { setMapActiveRouteInputSchema } from '@/lib/map/mapActiveRouteSchema';

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
});
