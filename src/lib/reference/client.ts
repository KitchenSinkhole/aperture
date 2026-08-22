'use client';

import { requestJson, type FetchResult } from '@/lib/http/fetchJson';
import type { WormholeJumpInfoRow } from '@/lib/eve/wormholeJumpInfo';
import type { ShipTypeGroupRow } from '@/lib/eve/shipTypes';

/**
 * Browser-side fetches for the app's static SDE reference catalogs. Each is
 * immutable for a session, so the first successful response is memoised and
 * reused — the Jump Info dialog can reopen, and the overlay can take a second
 * D-Scan paste, without re-hitting the network.
 */

let jumpInfoCache: WormholeJumpInfoRow[] | null = null;

export async function fetchWormholeJumpInfo(): Promise<FetchResult<WormholeJumpInfoRow[]>> {
  if (jumpInfoCache) return { ok: true, data: jumpInfoCache };
  const result = await requestJson<FetchResult<WormholeJumpInfoRow[]>>(
    'GET',
    '/api/reference/wormholes',
  );
  if (result.ok) jumpInfoCache = result.data;
  return result;
}

let shipTypeCache: ReadonlyMap<number, number> | null = null;

/**
 * Ship type id → SDE group id, for telling ships from the rest of a D-Scan.
 * Resolves to null when the request fails, which `requestJson` has already
 * surfaced as a toast — callers degrade rather than treat everything as a hull.
 */
export async function fetchShipTypeGroups(): Promise<ReadonlyMap<number, number> | null> {
  if (shipTypeCache) return shipTypeCache;
  const result = await requestJson<FetchResult<ShipTypeGroupRow[]>>(
    'GET',
    '/api/reference/ship-types',
  );
  if (!result.ok) return null;
  shipTypeCache = new Map(result.data.map((r) => [r.typeId, r.groupId]));
  return shipTypeCache;
}
