import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apRouteDestination, apUser, universeSystem } from '@/db/schema';
import type { RouteDestinationView, RoutePrefs } from '@/types';

// routes-module. Server-side initial load for the route planner panel: the
// account's route settings (`ap_user`) + saved destinations joined to their
// solar-system display fields. Read at map-page load and threaded into the panel.

const DEFAULT_PREFS: RoutePrefs = {
  safety: 'shortest',
  minShipClass: null,
  avoidReduced: false,
  avoidCritical: false,
  avoidEol: false,
  includeEveScout: false,
};

/**
 * The account's route-planner settings + saved destinations. Defaults are used
 * when the `ap_user` row is somehow missing (mirrors the column defaults).
 */
export async function loadRouteConfig(
  userId: number,
): Promise<{ prefs: RoutePrefs; destinations: RouteDestinationView[] }> {
  const [userRows, destRows] = await Promise.all([
    db
      .select({
        safety: apUser.routeSafety,
        minShipClass: apUser.routeMinShipClass,
        avoidReduced: apUser.routeAvoidReduced,
        avoidCritical: apUser.routeAvoidCritical,
        avoidEol: apUser.routeAvoidEol,
        includeEveScout: apUser.routeIncludeEveScout,
      })
      .from(apUser)
      .where(eq(apUser.id, userId)),
    db
      .select({
        id: apRouteDestination.id,
        systemId: apRouteDestination.systemId,
        label: apRouteDestination.label,
        name: universeSystem.name,
        security: universeSystem.security,
        securityStatus: universeSystem.securityStatus,
      })
      .from(apRouteDestination)
      .innerJoin(universeSystem, eq(apRouteDestination.systemId, universeSystem.id))
      .where(eq(apRouteDestination.userId, userId))
      .orderBy(apRouteDestination.createdAt),
  ]);

  const prefs: RoutePrefs = userRows[0] ?? DEFAULT_PREFS;
  const destinations: RouteDestinationView[] = destRows.map((r) => ({
    id: Number(r.id),
    systemId: r.systemId,
    name: r.name,
    security: r.security,
    securityStatus: r.securityStatus,
    label: r.label,
  }));
  return { prefs, destinations };
}
