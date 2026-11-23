import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMap, apMapConnection, apMapSystem } from '@/db/schema';
import { computeDisconnected, computeSubchain, neighborsOf } from '@/lib/map/subchainGraph';
import type { MapEventPayload } from '@/lib/realtime/protocol';
import type { ActionResult } from './core';
import { deleteConnection } from './connections';
import { removeSystem } from './systems';

/**
 * Delete-subchain orchestrator. Resolves the head's subchain (head + everything
 * orphaned from the keep-side anchor by removing the head — see
 * `subchainGraph.ts`) and tears it down under a single outer `db.transaction`:
 * every connection touching the set is hard-deleted, then every system in it is
 * soft-deleted (`visible=false`), each routed through the existing
 * `deleteConnection` / `removeSystem` helpers with the shared `tx`. All N events
 * commit atomically (the `tg_map_event_notify` trigger fires once per row after
 * commit); if any helper throws, the whole batch rolls back.
 *
 * The anchor is the map's Home when one is set; otherwise the caller must pass a
 * neighbour of the head to keep (`anchorMapSystemId`). Returns the full
 * committed `MapEventPayload[]` so the initiating client registers every
 * `eventId` in its dedupe set and folds each payload locally — the same contract
 * the bulk-paste path uses.
 */

export type DeleteSubchainInput = {
  mapId: bigint;
  /** `ap_map_system.id` of the system to delete along with its branch. */
  headMapSystemId: bigint;
  /**
   * `ap_map_system.id` of the keep-side neighbour, used only when the map has no
   * Home. Ignored when a Home is designated (Home is always the anchor then).
   */
  anchorMapSystemId: bigint | null;
  characterId: bigint | null;
};

export type SubchainDeleteSummary = {
  systemsRemoved: number;
  connectionsRemoved: number;
};

export type SubchainDeleteResult = {
  summary: SubchainDeleteSummary;
  payloads: MapEventPayload[];
};

export async function deleteSubchain(
  input: DeleteSubchainInput,
): Promise<ActionResult<SubchainDeleteResult>> {
  try {
    const result = await db.transaction(async (tx) => {
      const [map] = await tx
        .select({ homeMapSystemId: apMap.homeMapSystemId })
        .from(apMap)
        .where(eq(apMap.id, input.mapId));
      if (!map) throw new Error('Map not found.');

      // Anchor (keep-side root): the Home when set, else the caller-picked
      // neighbour. Home always wins so a misuse can't delete known space.
      const anchorId = map.homeMapSystemId ?? input.anchorMapSystemId;
      if (anchorId === null) {
        throw new Error('No Home system is set — choose a system to keep.');
      }
      if (anchorId === input.headMapSystemId) {
        throw new Error('The system to delete and the system to keep must differ.');
      }

      const systemRows = await tx
        .select({ id: apMapSystem.id })
        .from(apMapSystem)
        .where(and(eq(apMapSystem.mapId, input.mapId), eq(apMapSystem.visible, true)));
      const visibleIds = new Set(systemRows.map((s) => s.id.toString()));

      const headId = input.headMapSystemId.toString();
      const anchorKey = anchorId.toString();
      if (!visibleIds.has(headId)) throw new Error('System not found on map.');
      if (!visibleIds.has(anchorKey)) throw new Error('Keep-side system not found on map.');

      const connectionRows = await tx
        .select({
          id: apMapConnection.id,
          source: apMapConnection.sourceMapSystemId,
          target: apMapConnection.targetMapSystemId,
        })
        .from(apMapConnection)
        .where(eq(apMapConnection.mapId, input.mapId));
      const connections = connectionRows.map((c) => ({
        id: c.id,
        source: c.source.toString(),
        target: c.target.toString(),
      }));

      // With no Home, the keep-side must be a direct neighbour of the head — the
      // UX only ever offers neighbours, and it keeps the picked anchor meaningful.
      if (map.homeMapSystemId === null) {
        const neighbours = neighborsOf(connections, headId);
        if (!neighbours.includes(anchorKey)) {
          throw new Error('The system to keep must be directly connected to the deleted system.');
        }
      }

      const subchain = computeSubchain({
        systems: systemRows.map((s) => ({ id: s.id.toString() })),
        connections,
        headId,
        anchorId: anchorKey,
      });
      if (subchain.size === 0) throw new Error('Nothing to delete.');

      const payloads: MapEventPayload[] = [];

      // Hard-delete every connection touching the doomed set first (this includes
      // the collapsed head↔anchor hole and any loop-back edges), then soft-delete
      // the systems.
      for (const c of connectionRows) {
        if (!subchain.has(c.source.toString()) && !subchain.has(c.target.toString())) continue;
        const res = await deleteConnection({
          mapId: input.mapId,
          connectionId: c.id,
          characterId: input.characterId,
          cause: 'manual_removed',
          tx,
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
      }
      const connectionsRemoved = payloads.length;

      for (const id of subchain) {
        const res = await removeSystem({
          mapId: input.mapId,
          mapSystemId: BigInt(id),
          characterId: input.characterId,
          tx,
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
      }

      const summary: SubchainDeleteSummary = {
        systemsRemoved: subchain.size,
        connectionsRemoved,
      };
      return { summary, payloads };
    });

    return { ok: true, data: result, eventId: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delete subchain failed.' };
  }
}

export type DeleteDisconnectedInput = {
  mapId: bigint;
  characterId: bigint | null;
};

/**
 * Delete-disconnected orchestrator. Resolves every visible system with no path
 * back to the map's Home (`computeDisconnected`, see `subchainGraph.ts`) and
 * tears it down under one outer `db.transaction`, reusing the exact teardown of
 * `deleteSubchain`: hard-delete every connection touching the doomed set, then
 * soft-delete the systems, all routed through `deleteConnection` / `removeSystem`
 * with the shared `tx`. Returns the N committed payloads.
 *
 * Requires a Home to be set — without one there's no anchor to measure
 * "disconnected" against, so the call throws.
 */
export async function deleteDisconnected(
  input: DeleteDisconnectedInput,
): Promise<ActionResult<SubchainDeleteResult>> {
  try {
    const result = await db.transaction(async (tx) => {
      const [map] = await tx
        .select({ homeMapSystemId: apMap.homeMapSystemId })
        .from(apMap)
        .where(eq(apMap.id, input.mapId));
      if (!map) throw new Error('Map not found.');
      if (map.homeMapSystemId === null) throw new Error('No Home system is set.');

      const systemRows = await tx
        .select({ id: apMapSystem.id })
        .from(apMapSystem)
        .where(and(eq(apMapSystem.mapId, input.mapId), eq(apMapSystem.visible, true)));
      const homeId = map.homeMapSystemId.toString();
      const visibleIds = new Set(systemRows.map((s) => s.id.toString()));
      if (!visibleIds.has(homeId)) throw new Error('Home system not found on map.');

      const connectionRows = await tx
        .select({
          id: apMapConnection.id,
          source: apMapConnection.sourceMapSystemId,
          target: apMapConnection.targetMapSystemId,
        })
        .from(apMapConnection)
        .where(eq(apMapConnection.mapId, input.mapId));
      const connections = connectionRows.map((c) => ({
        id: c.id,
        source: c.source.toString(),
        target: c.target.toString(),
      }));

      const doomed = computeDisconnected({
        systems: systemRows.map((s) => ({ id: s.id.toString() })),
        connections,
        homeId,
      });
      if (doomed.size === 0) throw new Error('Nothing to delete.');

      const payloads: MapEventPayload[] = [];

      for (const c of connectionRows) {
        if (!doomed.has(c.source.toString()) && !doomed.has(c.target.toString())) continue;
        const res = await deleteConnection({
          mapId: input.mapId,
          connectionId: c.id,
          characterId: input.characterId,
          cause: 'manual_removed',
          tx,
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
      }
      const connectionsRemoved = payloads.length;

      for (const id of doomed) {
        const res = await removeSystem({
          mapId: input.mapId,
          mapSystemId: BigInt(id),
          characterId: input.characterId,
          tx,
        });
        if (!res.ok) throw new Error(res.error);
        payloads.push(res.data);
      }

      const summary: SubchainDeleteSummary = {
        systemsRemoved: doomed.size,
        connectionsRemoved,
      };
      return { summary, payloads };
    });

    return { ok: true, data: result, eventId: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delete disconnected failed.' };
  }
}
