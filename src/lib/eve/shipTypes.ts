import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { universeCategory, universeGroup, universeType } from '@/db/schema';

/** How the SDE classifies one scanned type id. */
export type ScanTypeRow = {
  typeId: number;
  groupId: number;
  isShip: boolean;
};

/**
 * Classify scanned type ids against the ingested SDE.
 *
 * A D-Scan reports everything in range — structures, probes, drones, wrecks —
 * through the same columns as hulls, so the overlay has to ask which ids are
 * ships. Membership is the SDE's own `Ship` category, so capsules count, and
 * an unpublished hull still classifies as a ship.
 *
 * Only ids the SDE carries come back: an id absent from the result is one this
 * build has never heard of, which the caller must distinguish from a known
 * non-ship rather than discard. The group rides along so the caller can resolve
 * a `ShipClass` for a hull no tracked pilot is flying, through the same group
 * table `resolveShipClass` uses.
 */
export async function classifyScanTypes(typeIds: readonly number[]): Promise<ScanTypeRow[]> {
  const ids = [...new Set(typeIds)];
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      typeId: universeType.id,
      groupId: universeType.groupId,
      categoryName: universeCategory.name,
    })
    .from(universeType)
    .innerJoin(universeGroup, eq(universeType.groupId, universeGroup.id))
    .innerJoin(universeCategory, eq(universeGroup.categoryId, universeCategory.id))
    .where(inArray(universeType.id, ids));

  return rows.map((r) => ({
    typeId: r.typeId,
    groupId: r.groupId,
    isShip: r.categoryName === 'Ship',
  }));
}
