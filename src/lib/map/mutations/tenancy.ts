import { and, eq } from 'drizzle-orm';
import { apMapConnection, apMapSystem } from '@/db/schema';
import type { Tx } from './core';

/**
 * Tenancy-binding asserts for the create paths. `map_update` authority (via
 * `requireMapMutate`) only proves the caller can act on the map named in the
 * request — it says nothing about whether a body-supplied child id (a
 * `mapSystemId` / `mapConnectionId`) actually belongs to that map. Both
 * `ap_map_system.id` and `ap_map_connection.id` are sequential/enumerable, so
 * without this check an authorized caller on map A could attach a row to a
 * system or connection on map B by naming its id directly.
 */

/** Throws when `mapSystemId` does not belong to `mapId`. */
export async function assertSystemOnMap(
  tx: Tx,
  mapSystemId: bigint,
  mapId: bigint,
): Promise<void> {
  const [row] = await tx
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.id, mapSystemId), eq(apMapSystem.mapId, mapId)));
  if (!row) throw new Error('System does not belong to this map.');
}

/** Throws when `connectionId` does not belong to `mapId`. */
export async function assertConnectionOnMap(
  tx: Tx,
  connectionId: bigint,
  mapId: bigint,
): Promise<void> {
  const [row] = await tx
    .select({ id: apMapConnection.id })
    .from(apMapConnection)
    .where(and(eq(apMapConnection.id, connectionId), eq(apMapConnection.mapId, mapId)));
  if (!row) throw new Error('Connection does not belong to this map.');
}
