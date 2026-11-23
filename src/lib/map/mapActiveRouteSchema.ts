import { z } from 'zod';
import type { RoutePlan } from '@/types';

export const setMapActiveRouteInputSchema = z.object({
  mapId: z.string().min(1),
  primaryCharacterId: z.number().int().positive(),
  destinationSystemId: z.number().int().positive(),
  plan: z.custom<RoutePlan>(),
  followerCharacterIds: z.array(z.number().int().positive()).min(1),
});
