import 'server-only';
import { and, eq, inArray, ne, or, type InferInsertModel } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapSystem,
  systemStatus,
  universeStargateEdge,
} from '@/db/schema';
import { buildSystemNode } from '../systemNode';
import { assignTagOnAdd } from '@/lib/tagging/service';
import { commitMapEvent, enqueueWebhookDispatch, type ActionResult, type Tx } from './core';
import { createConnection } from './connections';
import type { MapEventPatch, MapEventPayload } from '@/lib/realtime/protocol';

/**
 * System-level map mutations. Each is exactly one `commitMapEvent` call (one
 * `ap_map_event` row → one realtime broadcast). Per the CLAUDE.md lifecycle
 * rule, systems are never hard-deleted: removal flips `visible = false` so prior
 * intel/tags/status survive a re-add.
 */

type SystemStatus = (typeof systemStatus.enumValues)[number];

export type AddSystemInput = {
  mapId: bigint;
  /** EVE solar-system id (`universe_system.id`). */
  systemId: number;
  characterId: bigint | null;
  positionX?: number;
  positionY?: number;
  /** Optional outer transaction (joined by `addSystemWithStargateLinks` so the add + its gate links commit atomically). */
  tx?: Tx;
};

/** The system.added event plus any auto-created `stargate` connection events, in commit order. */
export type AddSystemResult = {
  payloads: MapEventPayload[];
};

export type RemoveSystemInput = {
  mapId: bigint;
  /** `ap_map_system.id` (the xyflow node id). */
  mapSystemId: bigint;
  characterId: bigint | null;
  /** Optional outer transaction (joined by `subchain.ts` to drop a whole branch atomically). */
  tx?: Tx;
};

/** Fields a client may change on a placed system. Omitted keys are left untouched. */
export type UpdateSystemPatch = {
  alias?: string | null;
  tag?: string | null;
  status?: SystemStatus;
  intelNotes?: string | null;
  locked?: boolean;
  /** Non-null sets a rally point; null clears it. */
  rallyAt?: Date | null;
  positionX?: number;
  positionY?: number;
};

export type UpdateSystemInput = {
  mapId: bigint;
  mapSystemId: bigint;
  characterId: bigint | null;
  patch: UpdateSystemPatch;
};

/**
 * Add a solar system to a map. Inserts a new visible row, or — reusing the
 * `(map_id, system_id)` unique row — flips a previously-removed one back to
 * `visible = true` while leaving its alias/tag/status/intel intact. Emits
 * `system.added` carrying the full node body the canvas needs to render it.
 */
export function addSystem(input: AddSystemInput): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'system.added',
    tx: input.tx,
    mutate: async (tx) => {
      const now = new Date();
      const reactivate: Partial<InferInsertModel<typeof apMapSystem>> = {
        visible: true,
        lastVisibleAt: now,
        updatedAt: now,
      };
      if (input.positionX !== undefined) reactivate.positionX = input.positionX;
      if (input.positionY !== undefined) reactivate.positionY = input.positionY;

      const [row] = await tx
        .insert(apMapSystem)
        .values({
          mapId: input.mapId,
          systemId: input.systemId,
          visible: true,
          positionX: input.positionX,
          positionY: input.positionY,
        })
        .onConflictDoUpdate({
          target: [apMapSystem.mapId, apMapSystem.systemId],
          set: reactivate,
        })
        .returning({ id: apMapSystem.id });

      // Auto-tagging. ABC assigns here so the tag rides in the
      // `system.added` payload; 0121 clears any tag preserved by the upsert and
      // re-tags later on reconnect. No-op when the map runs no scheme.
      await assignTagOnAdd(tx, input.mapId, row!.id);

      return buildSystemNode(tx, row!.id);
    },
  });
}

/** Remove a system from a map: flip `visible = false` (the row persists). Emits `system.removed`. */
export function removeSystem(input: RemoveSystemInput): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'system.removed',
    tx: input.tx,
    mutate: async (tx) => {
      // Locked-system delete guard: a locked system is a full block on removal —
      // it forces a mindful unlock before deletion (issue #157). Applies to every
      // delete path, since they all route through here (single, group, subchain,
      // disconnected); a locked system anywhere in a subchain rolls the whole
      // batch back.
      const [target] = await tx
        .select({ locked: apMapSystem.locked })
        .from(apMapSystem)
        .where(and(eq(apMapSystem.id, input.mapSystemId), eq(apMapSystem.mapId, input.mapId)));
      if (!target) throw new Error('System not found on map.');
      if (target.locked) {
        throw new Error('Cannot remove a locked system. Unlock it first.');
      }

      // Home-system delete guard: the auto-tagging Home is the
      // node both schemes calculate from and must not be removable while
      // designated. Clear it in map settings first.
      const [map] = await tx
        .select({ homeMapSystemId: apMap.homeMapSystemId })
        .from(apMap)
        .where(eq(apMap.id, input.mapId));
      if (map?.homeMapSystemId === input.mapSystemId) {
        throw new Error('Cannot remove the Home system while it is designated. Clear Home in map settings first.');
      }

      const now = new Date();
      const [row] = await tx
        .update(apMapSystem)
        .set({ visible: false, lastVisibleAt: now, updatedAt: now })
        .where(and(eq(apMapSystem.id, input.mapSystemId), eq(apMapSystem.mapId, input.mapId)))
        .returning({ id: apMapSystem.id });
      if (!row) throw new Error('System not found on map.');

      // Dormant the incident wormhole connections rather than deleting them: a
      // soft-removed system's wh links become memory (kept for an in-place
      // restore once the sig is re-pasted — Stage 4), hidden from the view via
      // `loadMapForView`'s `confirmed_at IS NOT NULL` filter. The single
      // `system.removed` broadcast already prunes every incident connection on
      // each client regardless of scope, so live + reload now agree. Non-`wh`
      // links stay confirmed and re-link structurally via
      // `addSystemWithStargateLinks` on re-add.
      await tx
        .update(apMapConnection)
        .set({ confirmedAt: null })
        .where(
          and(
            eq(apMapConnection.mapId, input.mapId),
            eq(apMapConnection.scope, 'wh'),
            or(
              eq(apMapConnection.sourceMapSystemId, input.mapSystemId),
              eq(apMapConnection.targetMapSystemId, input.mapSystemId),
            ),
          ),
        );

      return { id: row.id.toString() };
    },
  });
}

/** Update a system's intel/position fields. Only the keys present in `patch` change. Emits `system.updated`. */
export function updateSystem(input: UpdateSystemInput): Promise<ActionResult<MapEventPayload>> {
  return commitMapEvent({
    mapId: input.mapId,
    characterId: input.characterId,
    kind: 'system.updated',
    mutate: async (tx) => {
      const { patch } = input;
      const set: Partial<InferInsertModel<typeof apMapSystem>> = { updatedAt: new Date() };
      if ('alias' in patch) set.alias = patch.alias;
      if ('tag' in patch) set.tag = patch.tag;
      if ('status' in patch) set.status = patch.status;
      if ('intelNotes' in patch) set.intelNotes = patch.intelNotes;
      if ('locked' in patch) set.locked = patch.locked;
      if ('rallyAt' in patch) set.rallyAt = patch.rallyAt;
      if ('positionX' in patch) set.positionX = patch.positionX;
      if ('positionY' in patch) set.positionY = patch.positionY;

      const [row] = await tx
        .update(apMapSystem)
        .set(set)
        .where(and(eq(apMapSystem.id, input.mapSystemId), eq(apMapSystem.mapId, input.mapId)))
        .returning({ id: apMapSystem.id });
      if (!row) throw new Error('System not found on map.');

      const out: MapEventPatch<'system.updated'> = { id: row.id.toString() };
      if ('alias' in patch) out.alias = patch.alias;
      if ('tag' in patch) out.tag = patch.tag;
      if ('status' in patch) out.status = patch.status;
      if ('intelNotes' in patch) out.intelNotes = patch.intelNotes;
      if ('locked' in patch) out.locked = patch.locked;
      if ('rallyAt' in patch) out.rallyAt = patch.rallyAt ? patch.rallyAt.toISOString() : null;
      if ('positionX' in patch) out.positionX = patch.positionX;
      if ('positionY' in patch) out.positionY = patch.positionY;
      return out;
    },
  });
}

/**
 * Add a solar system and auto-link it to every system already on the map that
 * shares an in-game stargate with it (`universe_stargate_edge`). The system add
 * plus each `stargate` connection commit atomically under one transaction and
 * return as an ordered `MapEventPayload[]` (the `system.added` event first), so
 * the client folds them like a bulk paste.
 *
 * K-space / Pochven systems pick up gate links; wormhole systems have no
 * stargate edges and so add with zero extra events. A re-added system that
 * already carries `stargate` links to a neighbour is not duplicated.
 */
export async function addSystemWithStargateLinks(
  input: AddSystemInput,
): Promise<ActionResult<AddSystemResult>> {
  try {
    const payloads = await db.transaction(async (tx) => {
      const out: MapEventPayload[] = [];

      const added = await addSystem({ ...input, tx });
      if (!added.ok) throw new Error(added.error);
      out.push(added.data);
      if (added.data.kind !== 'system.added') throw new Error('Unexpected add payload.');
      const newMapSystemId = BigInt(added.data.id);

      // Visible systems on this map that share a stargate with the new one. The
      // edge table is bidirectional (one row per direction); matching neighbour→new
      // is enough to catch every gate-adjacent system exactly once.
      const neighbors = await tx
        .select({ mapSystemId: apMapSystem.id })
        .from(apMapSystem)
        .innerJoin(
          universeStargateEdge,
          and(
            eq(universeStargateEdge.fromSystemId, apMapSystem.systemId),
            eq(universeStargateEdge.toSystemId, input.systemId),
          ),
        )
        .where(
          and(
            eq(apMapSystem.mapId, input.mapId),
            eq(apMapSystem.visible, true),
            ne(apMapSystem.id, newMapSystemId),
          ),
        );

      if (neighbors.length > 0) {
        const neighborIds = neighbors.map((n) => n.mapSystemId);
        // A removed system keeps its connection rows (soft-delete), so a re-add
        // can find pre-existing gate links — skip those to avoid duplicates.
        const existing = await tx
          .select({
            source: apMapConnection.sourceMapSystemId,
            target: apMapConnection.targetMapSystemId,
          })
          .from(apMapConnection)
          .where(
            and(
              eq(apMapConnection.mapId, input.mapId),
              eq(apMapConnection.scope, 'stargate'),
              or(
                and(
                  eq(apMapConnection.sourceMapSystemId, newMapSystemId),
                  inArray(apMapConnection.targetMapSystemId, neighborIds),
                ),
                and(
                  eq(apMapConnection.targetMapSystemId, newMapSystemId),
                  inArray(apMapConnection.sourceMapSystemId, neighborIds),
                ),
              ),
            ),
          );
        const newKey = newMapSystemId.toString();
        const linked = new Set<string>();
        for (const e of existing) {
          linked.add(e.source.toString() === newKey ? e.target.toString() : e.source.toString());
        }

        for (const n of neighbors) {
          if (linked.has(n.mapSystemId.toString())) continue;
          const conn = await createConnection({
            mapId: input.mapId,
            characterId: input.characterId,
            sourceMapSystemId: newMapSystemId,
            targetMapSystemId: n.mapSystemId,
            scope: 'stargate',
            tx,
          });
          if (!conn.ok) throw new Error(conn.error);
          out.push(conn.data);
        }
      }

      return out;
    });

    // Webhook fanout for the system add (preserves the standalone-add behaviour
    // the joined transaction would otherwise skip). The auto gate links are
    // structural and deliberately do NOT notify — they'd only add noise.
    await enqueueWebhookDispatch(input.mapId, payloads[0]!.eventId, new Date());

    return { ok: true, data: { payloads }, eventId: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Add system failed.' };
  }
}

// `buildSystemNode` moved to `../systemNode.ts` so the location-poll
// fold (`src/lib/jobs/locationCommit.ts`) can share the same payload builder
// without inheriting this file's `'server-only'` guard.
