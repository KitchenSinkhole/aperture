import { z } from 'zod';

export const characterWaypointBodySchema = z.union([
  z.object({
    characterId: z.number().int().positive(),
    destinationId: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('sequence'),
    characterId: z.number().int().positive(),
    waypointSystemIds: z.array(z.number().int().positive()).min(1).max(24),
  }),
]);
