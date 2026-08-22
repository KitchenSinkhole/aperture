import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { universeCategory, universeGroup, universeType } from '@/db/schema';

/** One published ship hull: its type id and the SDE group that classifies it. */
export type ShipTypeGroupRow = {
  typeId: number;
  groupId: number;
};

/**
 * Every published Ship-category type id with its `universe_group.id`.
 *
 * The authoritative answer to "is this type id a ship?", which a D-Scan paste
 * needs because a scan reports everything in range — structures, probes,
 * drones, wrecks — through the same columns as hulls. Membership is the SDE's
 * own `Ship` category, so capsules count as ships. It comes from the ingested
 * SDE, so a hull released after any given build classifies as soon as the SDE
 * refresh picks it up.
 *
 * The group rides along so the caller can resolve a `ShipClass` for a hull no
 * tracked pilot is flying, through the same group table `resolveShipClass` uses.
 */
export async function shipTypeGroups(): Promise<ShipTypeGroupRow[]> {
  return db
    .select({ typeId: universeType.id, groupId: universeType.groupId })
    .from(universeType)
    .innerJoin(universeGroup, eq(universeType.groupId, universeGroup.id))
    .innerJoin(universeCategory, eq(universeGroup.categoryId, universeCategory.id))
    .where(and(eq(universeCategory.name, 'Ship'), eq(universeType.published, true)))
    .orderBy(asc(universeType.id));
}
