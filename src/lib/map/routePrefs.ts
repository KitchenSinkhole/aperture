import 'server-only';
import { z } from 'zod';
import { routeSafety, whJumpMass } from '@/db/schema';
import type { RoutePrefs } from '@/types';

// routes-module. Shared `RoutePrefs` validator at the system boundary, reused by
// the persist Server Action (`actions/routes.ts`) and the compute API route
// (`/api/map/[mapId]/route-plan`). Kept out of the `'use server'` action file,
// which may only export async functions.

export const routePrefsSchema: z.ZodType<RoutePrefs> = z.object({
  safety: z.enum(routeSafety.enumValues),
  minShipClass: z.enum(whJumpMass.enumValues).nullable(),
  avoidReduced: z.boolean(),
  avoidCritical: z.boolean(),
  avoidEol: z.boolean(),
  includeEveScout: z.boolean(),
  includeJumpBridge: z.boolean().optional(),
});
