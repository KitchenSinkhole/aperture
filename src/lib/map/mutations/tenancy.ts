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

/**
 * Bindings already confirmed within one open transaction. A bulk paste asserts
 * its target system up front and then every per-row helper asserts the same
 * pair again, so an N-signature paste would issue N+1 identical queries while
 * holding the write transaction's locks. A row's owning map never changes, so
 * the first confirmation stands for the rest of the transaction. Only positive
 * results land here; a failure throws and aborts the transaction.
 */
const confirmed = new WeakMap<Tx, Set<string>>();

function isConfirmed(tx: Tx, key: string): boolean {
  return confirmed.get(tx)?.has(key) ?? false;
}

function confirm(tx: Tx, key: string): void {
  const seen = confirmed.get(tx);
  if (seen) seen.add(key);
  else confirmed.set(tx, new Set([key]));
}

/** Throws when `mapSystemId` does not belong to `mapId`. */
export async function assertSystemOnMap(
  tx: Tx,
  mapSystemId: bigint,
  mapId: bigint,
): Promise<void> {
  const key = `s${mapSystemId}:${mapId}`;
  if (isConfirmed(tx, key)) return;
  const [row] = await tx
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.id, mapSystemId), eq(apMapSystem.mapId, mapId)));
  if (!row) throw new Error('System does not belong to this map.');
  confirm(tx, key);
}

/** Throws when `connectionId` does not belong to `mapId`. */
export async function assertConnectionOnMap(
  tx: Tx,
  connectionId: bigint,
  mapId: bigint,
): Promise<void> {
  const key = `c${connectionId}:${mapId}`;
  if (isConfirmed(tx, key)) return;
  const [row] = await tx
    .select({ id: apMapConnection.id })
    .from(apMapConnection)
    .where(and(eq(apMapConnection.id, connectionId), eq(apMapConnection.mapId, mapId)));
  if (!row) throw new Error('Connection does not belong to this map.');
  confirm(tx, key);
}
