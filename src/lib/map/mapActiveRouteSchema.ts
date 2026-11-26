import { z } from 'zod';

/** Caps for stored active route payloads (BUILD 2 experimental). */
export const ACTIVE_ROUTE_MAX_FOLLOWERS = 50;
export const ACTIVE_ROUTE_MAX_HOPS = 200;

const routeHopSchema = z.object({
  systemId: z.number().int().positive(),
  name: z.string().max(200),
  security: z.string().max(16).nullable(),
  securityStatus: z.number().nullable(),
  via: z.enum(['origin', 'gate', 'wh', 'jumpbridge', 'eve_scout']),
  connectionId: z.number().int().positive().nullable(),
  onMap: z.boolean(),
  tag: z.string().max(32).nullable(),
  viaSigId: z.string().max(32).nullable(),
});

export const routePlanSchema = z.object({
  destinationSystemId: z.number().int().positive(),
  destinationName: z.string().max(200),
  reachable: z.boolean(),
  jumps: z.number().int().min(0),
  hops: z.array(routeHopSchema).max(ACTIVE_ROUTE_MAX_HOPS),
});

export const setMapActiveRouteInputSchema = z
  .object({
    mapId: z.string().regex(/^\d+$/, 'Invalid map id.'),
    primaryCharacterId: z.number().int().positive(),
    destinationSystemId: z.number().int().positive(),
    plan: routePlanSchema,
    followerCharacterIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(ACTIVE_ROUTE_MAX_FOLLOWERS),
  })
  .refine((v) => v.plan.destinationSystemId === v.destinationSystemId, {
    message: 'Plan destination does not match.',
  });

export const clearMapActiveRouteInputSchema = z.object({
  mapId: z.string().regex(/^\d+$/, 'Invalid map id.'),
});