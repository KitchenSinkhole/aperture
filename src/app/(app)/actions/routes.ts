'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apRouteDestination, apUser, universeSystem } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { routePrefsSchema } from '@/lib/map/routePrefs';
import type { RouteDestinationView } from '@/types';

// routes-module. Per-account route-planner config via Server Actions (CLAUDE.md
// mutation pathways: low-frequency, user-initiated state on `ap_user` /
// `ap_route_destination`). Personal config — not map data — so nothing here
// emits an `ap_map_event`. `revalidatePath('/','layout')` keeps a fresh
// navigation consistent; the panel also folds the returned row optimistically.

export type RouteActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

/** Persist the account's route-planner settings. */
export async function setRoutePrefsAction(input: unknown): Promise<RouteActionResult> {
  const session = await requireSession();
  const parsed = routePrefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid route settings.' };
  const p = parsed.data;
  await db
    .update(apUser)
    .set({
      routeSafety: p.safety,
      routeMinShipClass: p.minShipClass,
      routeAvoidReduced: p.avoidReduced,
      routeAvoidCritical: p.avoidCritical,
      routeAvoidEol: p.avoidEol,
      routeIncludeEveScout: p.includeEveScout,
      updatedAt: new Date(),
    })
    .where(eq(apUser.id, session.userId));
  revalidatePath('/', 'layout');
  return { ok: true };
}

const addDestinationSchema = z.object({
  systemId: z.number().int().positive(),
  label: z.string().trim().min(1).max(60).nullish(),
});

/**
 * Save a destination for the account. Validates the system exists, then upserts
 * (the `(user_id, system_id)` unique key makes a duplicate a no-op re-label).
 * Returns the destination joined to its system display fields for optimistic UI.
 */
export async function addRouteDestinationAction(
  input: unknown,
): Promise<RouteActionResult<RouteDestinationView>> {
  const session = await requireSession();
  const parsed = addDestinationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid destination.' };
  const { systemId } = parsed.data;
  const label = parsed.data.label ?? null;

  const [system] = await db
    .select({
      id: universeSystem.id,
      name: universeSystem.name,
      security: universeSystem.security,
      securityStatus: universeSystem.securityStatus,
    })
    .from(universeSystem)
    .where(eq(universeSystem.id, systemId));
  if (!system) return { ok: false, error: 'No such system.' };

  const [row] = await db
    .insert(apRouteDestination)
    .values({ userId: session.userId, systemId, label })
    .onConflictDoUpdate({
      target: [apRouteDestination.userId, apRouteDestination.systemId],
      set: { label },
    })
    .returning({ id: apRouteDestination.id, label: apRouteDestination.label });

  revalidatePath('/', 'layout');
  return {
    ok: true,
    data: {
      id: Number(row!.id),
      systemId: system.id,
      name: system.name,
      security: system.security,
      securityStatus: system.securityStatus,
      label: row!.label,
    },
  };
}

/** Remove a saved destination owned by the account. */
export async function removeRouteDestinationAction(
  destinationId: number,
): Promise<RouteActionResult> {
  const session = await requireSession();
  if (!Number.isInteger(destinationId) || destinationId <= 0) {
    return { ok: false, error: 'Invalid destination.' };
  }
  await db
    .delete(apRouteDestination)
    .where(
      and(
        eq(apRouteDestination.id, BigInt(destinationId)),
        eq(apRouteDestination.userId, session.userId),
      ),
    );
  revalidatePath('/', 'layout');
  return { ok: true };
}
