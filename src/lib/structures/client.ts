import { requestJson, type FetchResult } from '@/lib/http/fetchJson';
import type { CorpSearchResult, StructureIntel, UpwellStructureType } from '@/types';

/**
 * Browser-side fetch wrappers for the structure-intel REST routes. Unlike the
 * map mutations, these carry no `eventId` (structures emit no realtime event):
 * the caller awaits the returned `StructureIntel` and splices it into local
 * state directly. Network/error handling + toasts live in `requestJson`.
 */

export type CreateStructureBody = {
  /** The map the row is written on — the server derives the row's scope from it. */
  mapId: string;
  systemId: number;
  name: string;
  structureTypeId: number;
  ownerCorporationId?: number | null;
  ownerName?: string | null;
  notes?: string | null;
};

export type UpdateStructureBody = {
  name?: string;
  structureTypeId?: number;
  ownerCorporationId?: number | null;
  ownerName?: string | null;
  notes?: string | null;
};

export function createStructureOnServer(
  body: CreateStructureBody,
): Promise<FetchResult<StructureIntel>> {
  return requestJson<FetchResult<StructureIntel>>('POST', '/api/structures', body);
}

export function updateStructureOnServer(args: {
  structureId: string;
  patch: UpdateStructureBody;
}): Promise<FetchResult<StructureIntel>> {
  return requestJson<FetchResult<StructureIntel>>(
    'PATCH',
    `/api/structures/${args.structureId}`,
    args.patch,
  );
}

export function deleteStructureOnServer(args: {
  structureId: string;
}): Promise<FetchResult<{ id: string }>> {
  return requestJson<FetchResult<{ id: string }>>('DELETE', `/api/structures/${args.structureId}`);
}

/**
 * Corporation name search for the owner picker. Read-only (any signed-in user);
 * the caller debounces and a query under 3 chars returns `[]` from the server.
 */
export function searchCorporationsOnServer(
  query: string,
): Promise<FetchResult<CorpSearchResult[]>> {
  return requestJson<FetchResult<CorpSearchResult[]>>(
    'GET',
    `/api/structures/corp-search?q=${encodeURIComponent(query)}`,
  );
}

/** Upwell structure types for the picker. Static reference data — cached per session. */
let structureTypeCache: UpwellStructureType[] | null = null;

export async function fetchStructureTypes(): Promise<FetchResult<UpwellStructureType[]>> {
  if (structureTypeCache) return { ok: true, data: structureTypeCache };
  const result = await requestJson<FetchResult<UpwellStructureType[]>>('GET', '/api/structure-types');
  if (result.ok) structureTypeCache = result.data;
  return result;
}
