import type {
  ActionResult,
  AddSystemResult,
  BulkPasteOptions,
  BulkPasteResult,
  ConnectionMassLogEntry,
  ImportResult,
  MapEventPayload,
  MapExportFile,
  MapViewData,
  ParsedSigRow,
  ResolvedSigRow,
  RestoreConnectionResult,
  SignatureGroupKey,
  StructureIntel,
  SubchainDeleteResult,
  SystemIntelSummary,
  SystemSearchResult,
  SystemStatsSummary,
  TheraConnection,
  TheraSyncInput,
  TheraSyncResult,
  WormholeTypeOption,
} from '@/types';
import type {
  ConnectionScope,
  EolStage,
  SystemStatus,
  WhJumpMass,
  WhMass,
} from '@/lib/map/enumLabels';
import { requestJson, type FetchResult } from '@/lib/http/fetchJson';

/** GET responses don't carry an `eventId`; mutation routes do. */
export type { FetchResult };

/**
 * Client-side fetch wrappers for the JSON API routes.
 *
 * Each mutation helper returns `ActionResult<MapEventPayload>` — the same body
 * shape the route emits, so callers can feed the success payload straight into
 * `applyEvent`. The wrappers only handle the network layer; optimistic apply /
 * rollback is orchestrated in `MapCanvas` (it owns the view state).
 *
 * On a non-2xx response or thrown network error the helpers fire a `toast.error`
 * before returning the `{ ok: false, error }` result, so callers don't need to
 * duplicate the toast in every catch.
 */

// ---------------------------------------------------------------------------
// Shared input shapes — mirror the Zod route schemas so the wire stays the
// single source of truth. They are intentionally NOT the server-side patch
// types (which use native `Date`); these are what crosses the wire.
// ---------------------------------------------------------------------------

export type UpdateSystemBody = {
  alias?: string | null;
  tag?: string | null;
  status?: SystemStatus;
  intelNotes?: string | null;
  locked?: boolean;
  /** ISO datetime string; null clears the rally point. */
  rallyAt?: string | null;
  positionX?: number;
  positionY?: number;
};

export type CreateConnectionBody = {
  sourceMapSystemId: string;
  targetMapSystemId: string;
  scope: ConnectionScope;
  massStatus?: WhMass;
  jumpMassClass?: WhJumpMass | null;
  eolStage?: EolStage;
  preserveMass?: boolean;
  isRolling?: boolean;
  isStatic?: boolean;
};

export type UpdateConnectionBody = {
  scope?: ConnectionScope;
  massStatus?: WhMass;
  jumpMassClass?: WhJumpMass | null;
  eolStage?: EolStage;
  preserveMass?: boolean;
  isRolling?: boolean;
  isStatic?: boolean;
};

export type CreateSignatureBody = {
  mapSystemId: string;
  mapConnectionId?: string | null;
  sigId: string;
  groupKey?: SignatureGroupKey | null;
  typeId?: number | null;
  name?: string | null;
  description?: string | null;
  /** ISO datetime string. */
  expiresAt: string;
};

export type UpdateSignatureBody = {
  mapConnectionId?: string | null;
  sigId?: string;
  groupKey?: SignatureGroupKey | null;
  typeId?: number | null;
  name?: string | null;
  description?: string | null;
  expiresAt?: string;
};

// ---------------------------------------------------------------------------
// Shared fetch core. Folds all non-2xx + thrown errors into `{ ok: false }` and
// surfaces a toast so callers don't have to.
// ---------------------------------------------------------------------------

function mutationFetch<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<ActionResult<T>> {
  return requestJson<ActionResult<T>>(method, url, body);
}

function readFetch<T>(url: string): Promise<FetchResult<T>> {
  return requestJson<FetchResult<T>>('GET', url);
}

/**
 * Fetch the full authoritative map snapshot (`MapViewData`) for the on-error
 * resync failsafe in `MapCanvas`. Uses a bare `fetch` rather than `readFetch`
 * so a failed resync does NOT fire a second `toast.error` — it runs right after
 * a mutation that already surfaced its own error, so a second toast is just noise.
 */
export async function fetchMapSnapshot(mapId: string): Promise<FetchResult<MapViewData>> {
  try {
    const res = await fetch(`/api/map/${mapId}`, { credentials: 'same-origin' });
    const json = (await res.json().catch(() => null)) as FetchResult<MapViewData> | null;
    if (!json) return { ok: false, error: `Request failed (${res.status}).` };
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error.' };
  }
}

// ---------------------------------------------------------------------------
// System mutations
// ---------------------------------------------------------------------------

/**
 * Add a system. The route returns N committed event payloads — the
 * `system.added` event plus any auto-created `stargate` gate links to systems
 * already on the map — so callers fold `data.payloads` like a bulk paste
 * (the wrapper-level `eventId` is always `0`).
 */
export function addSystemOnServer(args: {
  mapId: string;
  systemId: number;
  positionX?: number;
  positionY?: number;
}): Promise<ActionResult<AddSystemResult>> {
  const { mapId, ...body } = args;
  return mutationFetch<AddSystemResult>('POST', `/api/map/${mapId}/systems`, body);
}

/**
 * Solar-system name search for the "add system manually" dialog. Read-only
 * (view rights), so it returns a plain `FetchResult` with no `eventId`. The
 * caller debounces; a query under 2 chars returns `[]` from the server.
 */
export function searchSystemsOnServer(args: {
  mapId: string;
  query: string;
}): Promise<FetchResult<SystemSearchResult[]>> {
  return readFetch<SystemSearchResult[]>(
    `/api/map/${args.mapId}/system-search?q=${encodeURIComponent(args.query)}`,
  );
}

export function updateSystemOnServer(args: {
  mapId: string;
  mapSystemId: string;
  patch: UpdateSystemBody;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>(
    'PATCH',
    `/api/map/${args.mapId}/systems/${args.mapSystemId}`,
    args.patch,
  );
}

export function removeSystemOnServer(args: {
  mapId: string;
  mapSystemId: string;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>(
    'DELETE',
    `/api/map/${args.mapId}/systems/${args.mapSystemId}`,
  );
}

// ---------------------------------------------------------------------------
// Connection mutations
// ---------------------------------------------------------------------------

export function createConnectionOnServer(args: {
  mapId: string;
  body: CreateConnectionBody;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>('POST', `/api/map/${args.mapId}/connections`, args.body);
}

export function updateConnectionOnServer(args: {
  mapId: string;
  connectionId: string;
  patch: UpdateConnectionBody;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>(
    'PATCH',
    `/api/map/${args.mapId}/connections/${args.connectionId}`,
    args.patch,
  );
}

export function deleteConnectionOnServer(args: {
  mapId: string;
  connectionId: string;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>(
    'DELETE',
    `/api/map/${args.mapId}/connections/${args.connectionId}`,
  );
}

/**
 * Restore a dormant wormhole connection (Stage 4 sig-memory restore): re-confirm
 * the connection and re-activate any hidden endpoint. Body-less. Returns the
 * committed event payloads (`system.added` per re-activated endpoint, then
 * `connection.create`) — register each `eventId` and fold each via `applyEvent`
 * (the wrapper-level `eventId` is always `0`).
 */
export function restoreConnectionOnServer(args: {
  mapId: string;
  connectionId: string;
}): Promise<ActionResult<RestoreConnectionResult>> {
  return mutationFetch<RestoreConnectionResult>(
    'POST',
    `/api/map/${args.mapId}/connections/${args.connectionId}/restore`,
  );
}

/**
 * List a connection's per-jump mass-log (read; view rights). Returns a plain
 * `FetchResult` — no `eventId`. The log is server-derived; the
 * inspector refetches on the `connectionMassLog` realtime task.
 */
export function fetchConnectionMassLog(args: {
  mapId: string;
  connectionId: string;
}): Promise<FetchResult<ConnectionMassLogEntry[]>> {
  return readFetch<ConnectionMassLogEntry[]>(
    `/api/map/${args.mapId}/connections/${args.connectionId}/mass-log`,
  );
}

// ---------------------------------------------------------------------------
// Delete subchain (delete a head system + its orphaned branch in one call)
// ---------------------------------------------------------------------------

/**
 * Delete a head system and everything orphaned from the keep-side anchor by
 * removing it. The server recomputes the set authoritatively; the client only
 * sends the head (+ a neighbour to keep when the map has no Home). Returns the N
 * committed event payloads — register each `eventId` and fold each via
 * `applyEvent` (the wrapper-level `eventId` is always `0`).
 */
export function deleteSubchainOnServer(args: {
  mapId: string;
  headMapSystemId: string;
  anchorMapSystemId?: string | null;
}): Promise<ActionResult<SubchainDeleteResult>> {
  return mutationFetch<SubchainDeleteResult>('POST', `/api/map/${args.mapId}/subchain`, {
    headMapSystemId: args.headMapSystemId,
    anchorMapSystemId: args.anchorMapSystemId ?? null,
  });
}

/**
 * Delete every visible system disconnected from the map's Home (the server
 * recomputes the set authoritatively from the live graph; no body is sent).
 * Returns the N committed event payloads — register each `eventId` and fold each
 * via `applyEvent` (the wrapper-level `eventId` is always `0`).
 */
export function deleteDisconnectedOnServer(args: {
  mapId: string;
}): Promise<ActionResult<SubchainDeleteResult>> {
  return mutationFetch<SubchainDeleteResult>('POST', `/api/map/${args.mapId}/disconnected`);
}

// ---------------------------------------------------------------------------
// System ping (transient attention pulse — not a mutation)
// ---------------------------------------------------------------------------

/**
 * Ping a system: broadcast a short attention pulse to every client viewing the
 * map. Not a mutation — no `ap_map_event`, no optimistic apply, no `eventId`.
 * The server fans a `systemNotification` (kind `ping`) that the initiator also
 * receives, so the underglow appears identically for everyone via
 * `MapUnderglowBridge`. Errors toast through `requestJson`.
 */
export function pingSystemOnServer(args: {
  mapId: string;
  mapSystemId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return requestJson<{ ok: true }>('POST', `/api/map/${args.mapId}/ping`, {
    mapSystemId: args.mapSystemId,
  });
}

// ---------------------------------------------------------------------------
// Signature mutations
// ---------------------------------------------------------------------------

export function createSignatureOnServer(args: {
  mapId: string;
  body: CreateSignatureBody;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>('POST', `/api/map/${args.mapId}/signatures`, args.body);
}

export function updateSignatureOnServer(args: {
  mapId: string;
  signatureId: string;
  patch: UpdateSignatureBody;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>(
    'PATCH',
    `/api/map/${args.mapId}/signatures/${args.signatureId}`,
    args.patch,
  );
}

export function deleteSignatureOnServer(args: {
  mapId: string;
  signatureId: string;
}): Promise<ActionResult<MapEventPayload>> {
  return mutationFetch<MapEventPayload>(
    'DELETE',
    `/api/map/${args.mapId}/signatures/${args.signatureId}`,
  );
}

// ---------------------------------------------------------------------------
// Signature paste — bulk diff + resolver preview
// ---------------------------------------------------------------------------

export type PasteSignaturesBody = {
  mapSystemId: string;
  rows: ParsedSigRow[];
  options: BulkPasteOptions;
};

/**
 * Bulk paste: server diffs `rows` against existing sigs and commits add /
 * update / remove (+ optional connection tear-down) atomically. Returns the
 * full committed event payloads so the caller can register each `eventId`
 * in its dedupe set and apply each payload locally — the bulk endpoint is
 * N-events, so the wrapper-level `eventId` is always `0` here.
 */
export function pasteSignaturesOnServer(args: {
  mapId: string;
  body: PasteSignaturesBody;
}): Promise<ActionResult<BulkPasteResult>> {
  return mutationFetch<BulkPasteResult>(
    'POST',
    `/api/map/${args.mapId}/signatures/bulk`,
    args.body,
  );
}

/**
 * Preview-only resolver. Feeds the paste dialog's preview table so users see
 * which rows will resolve to a known group / type before they submit. The
 * bulk POST always re-resolves authoritatively.
 */
export function resolveSignaturesOnServer(args: {
  mapId: string;
  rows: ParsedSigRow[];
}): Promise<FetchResult<ResolvedSigRow[]>> {
  return mutationFetch<ResolvedSigRow[]>(
    'POST',
    `/api/map/${args.mapId}/signatures/resolve`,
    { rows: args.rows },
  ).then((result) =>
    result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error },
  );
}

// ---------------------------------------------------------------------------
// Map import / export
// ---------------------------------------------------------------------------

/**
 * Download the map's current state as a `MapExportFile` (read; `map_export`
 * right). Returns a plain `FetchResult` — no `eventId`. The caller serialises
 * the result and triggers the browser download (so it can name the file).
 */
export function exportMapOnServer(args: { mapId: string }): Promise<FetchResult<MapExportFile>> {
  return readFetch<MapExportFile>(`/api/map/${args.mapId}/export`);
}

/**
 * Merge a `MapExportFile` into the open map (`map_import` right). Returns the N
 * committed event payloads (like the bulk-paste path) so the caller folds each
 * locally and registers its `eventId` for echo dedupe; the wrapper-level
 * `eventId` is always `0`.
 */
export function importMapOnServer(args: {
  mapId: string;
  data: unknown;
}): Promise<ActionResult<ImportResult>> {
  return mutationFetch<ImportResult>('POST', `/api/map/${args.mapId}/import`, args.data);
}

// ---------------------------------------------------------------------------
// Thera module
// ---------------------------------------------------------------------------

/**
 * List the current EVE-Scout Thera/Turnur connections (read; view rights).
 * Returns a plain `FetchResult` — no `eventId`. The module computes per-row
 * sync status client-side against its live `viewData`.
 */
export function fetchTheraConnections(args: {
  mapId: string;
}): Promise<FetchResult<TheraConnection[]>> {
  return readFetch<TheraConnection[]>(`/api/map/${args.mapId}/thera`);
}

/**
 * Fold the chosen Thera/Turnur connections onto the open map (`map_update`).
 * Returns the N committed event payloads (like the import / bulk-paste paths)
 * so the caller folds each locally and registers its `eventId` for echo dedupe;
 * the wrapper-level `eventId` is always `0`.
 */
export function syncTheraConnectionsOnServer(args: {
  mapId: string;
  connections: TheraSyncInput[];
}): Promise<ActionResult<TheraSyncResult>> {
  return mutationFetch<TheraSyncResult>('POST', `/api/map/${args.mapId}/thera/sync`, {
    connections: args.connections,
  });
}

// ---------------------------------------------------------------------------
// Batched read-side per-system data backfill (live-added systems)
// ---------------------------------------------------------------------------

/** Wire shape of `GET /api/map/[mapId]/system-data` — `stats`/`structures` are sparse. */
export type SystemDataBatch = {
  intel: Record<number, SystemIntelSummary>;
  stats: Record<number, SystemStatsSummary>;
  structures: Record<number, StructureIntel[]>;
};

/**
 * Backfill read-side per-system data (sov / FW / incursion intel + 24h activity
 * stats + structure intel) for systems added after the initial server render.
 * Read-only (view rights) — returns a plain `FetchResult`, no `eventId`.
 * `MapCanvas` calls this when new system ids appear in `viewData` and merges the
 * result into its intel / stats / structures state, so decorators and sidebar
 * modules fill in without a page reload.
 */
export function fetchSystemData(args: {
  mapId: string;
  systemIds: number[];
}): Promise<FetchResult<SystemDataBatch>> {
  return readFetch<SystemDataBatch>(
    `/api/map/${args.mapId}/system-data?systems=${args.systemIds.join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// Wormhole-type catalog lookup
// ---------------------------------------------------------------------------

/**
 * Tiny per-session cache keyed by `${mapId}:${universeSystemId}`. WH catalog
 * filtering is deterministic and immutable for a given system class, so a hit
 * lets the inspector swap between systems without re-fetching.
 */
const wormholeTypeCache = new Map<string, WormholeTypeOption[]>();

export async function fetchWormholeTypes(args: {
  mapId: string;
  /** EVE solar-system id, not `ap_map_system.id`. */
  universeSystemId: number;
}): Promise<FetchResult<WormholeTypeOption[]>> {
  const cacheKey = `${args.mapId}:${args.universeSystemId}`;
  const cached = wormholeTypeCache.get(cacheKey);
  if (cached) return { ok: true, data: cached };

  const result = await readFetch<WormholeTypeOption[]>(
    `/api/map/${args.mapId}/wormhole-types?systemId=${args.universeSystemId}`,
  );
  if (result.ok) wormholeTypeCache.set(cacheKey, result.data);
  return result;
}
