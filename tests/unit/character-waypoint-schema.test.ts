// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { characterWaypointBodySchema } from '@/lib/character/waypointRequestSchema';

describe('characterWaypointBodySchema', () => {
  it('accepts legacy single-destination body', () => {
    const result = characterWaypointBodySchema.safeParse({
      characterId: 1,
      destinationId: 30000142,
    });
    expect(result.success).toBe(true);
  });

  it('accepts multi-waypoint sequence mode', () => {
    const result = characterWaypointBodySchema.safeParse({
      mode: 'sequence',
      characterId: 1,
      waypointSystemIds: [30000142, 30002187],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty waypoint sequence', () => {
    const result = characterWaypointBodySchema.safeParse({
      mode: 'sequence',
      characterId: 1,
      waypointSystemIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('caps waypoint sequence length', () => {
    const ids = Array.from({ length: 25 }, (_, i) => 30_000_100 + i);
    const result = characterWaypointBodySchema.safeParse({
      mode: 'sequence',
      characterId: 1,
      waypointSystemIds: ids,
    });
    expect(result.success).toBe(false);
  });
});
