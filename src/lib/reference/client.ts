'use client';

import { requestJson, type FetchResult } from '@/lib/http/fetchJson';
import type { WormholeJumpInfoRow } from '@/lib/eve/wormholeJumpInfo';
import type { ScanTypeRow } from '@/lib/eve/shipTypes';

/**
 * Browser-side fetches for the app's static SDE reference catalogs. Each is
 * immutable for a session, so what has been resolved once is reused — the Jump
 * Info dialog can reopen, and the overlay can take a second D-Scan paste,
 * without re-hitting the network.
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

/** The SDE's verdict on a scanned type id. */
export type ScanTypeInfo = { groupId: number; isShip: boolean };

// typeId → its classification, or null once the server has confirmed the SDE
// does not carry that id. A failed request caches nothing, so it is retried.
const scanTypeCache = new Map<number, ScanTypeInfo | null>();

/**
 * Classify the type ids one D-Scan reported.
 *
 * Resolves to a map holding only the ids the SDE carries: an id the caller
 * asked about but does not find in the map is unknown to this build, which is
 * a different answer from a known non-ship.
 *
 * Resolves to **null** when the lookup fails, which `requestJson` has already
 * surfaced as a toast — callers must degrade visibly rather than read a failure
 * as a scan holding no ships.
 */
export async function fetchScanTypes(
  typeIds: readonly number[],
): Promise<ReadonlyMap<number, ScanTypeInfo> | null> {
  const missing = [...new Set(typeIds)].filter((id) => !scanTypeCache.has(id));
  if (missing.length > 0) {
    const result = await requestJson<FetchResult<ScanTypeRow[]>>(
      'POST',
      '/api/reference/scan-types',
      { typeIds: missing },
    );
    if (!result.ok) return null;
    // Absent from the reply is the answer "the SDE has no such type", so every
    // id asked about is recorded — otherwise each scan re-asks about the same
    // unknowns.
    for (const id of missing) scanTypeCache.set(id, null);
    for (const row of result.data) {
      scanTypeCache.set(row.typeId, { groupId: row.groupId, isShip: row.isShip });
    }
  }

  const known = new Map<number, ScanTypeInfo>();
  for (const id of typeIds) {
    const info = scanTypeCache.get(id);
    if (info) known.set(id, info);
  }
  return known;
}
