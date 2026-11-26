import { z } from 'zod';

/** Max serial ESI `setWaypoint` hops per request (first clears, rest append). */
export const CHARACTER_WAYPOINT_SEQUENCE_MAX = 10;

export const characterWaypointBodySchema = z.union([
  z.object({
    characterId: z.number().int().positive(),
    destinationId: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('sequence'),
    characterId: z.number().int().positive(),
    waypointSystemIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(CHARACTER_WAYPOINT_SEQUENCE_MAX),
  }),
]);
