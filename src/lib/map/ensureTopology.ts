// No `import 'server-only'` here: this is a low-level topology primitive shared
// by `thera.ts` (a `server-only` module) and any other map-fold pathway. It
// only touches the DB through `commitMapEvent`, which is itself worker-safe.
import { and, eq, or } from 'drizzle-orm';
import { apMapConnection, apMapSystem } from '@/db/schema';
import { assignTagOnAdd, assignTagOnConnect } from '@/lib/tagging/service';
import { getLogger } from '@/lib/log/logger';
import { commitMapEvent, type Tx } from './mutations/core';
import { buildSystemNode } from './systemNode';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * Shared "ensure a node is visible + ensure one `wh` edge between two nodes,
 * idempotently, as one `ap_map_event` per change" primitives. Both the Thera
 * fold (`syncTheraConnections`) and the fixed-destination resolve
 * (`resolveSignatureDestination`) drive their per-pair writes through these, so
 * the idempotency + tagging rules live in exactly one place.
 */

const log = getLogger('server');

export type EnsureSystemOutcome = {
  mapSystemId: bigint;
  /** The `system.added` payload when newly added; undefined when already visible. */
  payload?: MapEventPayload;
};

/**
 * Ensure `(mapId, systemId)` is present and visible. A previously-hidden row is
 * flipped visible while alias/tag/status/intel/position are preserved; a fresh
 * row is inserted at `pos`. Emits `system.added` only when the system was not
 * already visible (an idempotent re-visit returns its id with no payload). Runs
 * on the caller's `tx` so N ensures share one transaction.
 */
export async function ensureSystemVisible(
  tx: Tx,
  mapId: bigint,
  systemId: number,
  characterId: bigint | null,
  pos: { x: number; y: number },
): Promise<EnsureSystemOutcome> {
  const [existing] = await tx
    .select({ id: apMapSystem.id, visible: apMapSystem.visible })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, systemId)));
  if (existing?.visible) return { mapSystemId: existing.id };

  let mapSystemId: bigint | null = null;
  const res = await commitMapEvent({
    mapId,
    characterId,
    kind: 'system.added',
    tx,
    mutate: async (innerTx) => {
      const now = new Date();
      const [row] = await innerTx
        .insert(apMapSystem)
        .values({ mapId, systemId, visible: true, positionX: pos.x, positionY: pos.y })
        .onConflictDoUpdate({
          target: [apMapSystem.mapId, apMapSystem.systemId],
          // Preserve alias/tag/status/intel/position on a re-add (mirrors locationCommit).
          set: { visible: true, lastVisibleAt: now, updatedAt: now },
        })
        .returning({ id: apMapSystem.id });
      mapSystemId = row!.id;
      // ABC tags here so it rides in `system.added`; 0121 clears + re-tags on connect.
      await assignTagOnAdd(innerTx, mapId, row!.id);
      return buildSystemNode(innerTx, row!.id);
    },
  });
  if (!res.ok) throw new Error(res.error);
  if (mapSystemId === null) throw new Error('system.added returned without a map_system id');
  return { mapSystemId, payload: res.data };
}

export type EnsureConnectionOutcome = {
  mapConnectionId: bigint;
  /** The `connection.create` payload when newly created; null when the pair already linked. */
  payload: MapEventPayload | null;
};

/**
 * Ensure a single `wh` connection links the two systems. Skips creation when an
 * edge already links the pair in **either direction** (returning that edge's id
 * with a null payload); otherwise inserts a fresh `wh`/`fresh` connection and
 * returns its `connection.create` payload. Throws on a self-loop guard failure
 * only via the caller — a source === target pair is impossible here since the
 * two ids come from distinct systems, but we still short-circuit defensively.
 */
export async function ensureWhConnection(
  tx: Tx,
  mapId: bigint,
  sourceMapSystemId: bigint,
  targetMapSystemId: bigint,
  characterId: bigint | null,
): Promise<EnsureConnectionOutcome> {
  const [existing] = await tx
    .select({ id: apMapConnection.id })
    .from(apMapConnection)
    .where(
      and(
        eq(apMapConnection.mapId, mapId),
        or(
          and(
            eq(apMapConnection.sourceMapSystemId, sourceMapSystemId),
            eq(apMapConnection.targetMapSystemId, targetMapSystemId),
          ),
          and(
            eq(apMapConnection.sourceMapSystemId, targetMapSystemId),
            eq(apMapConnection.targetMapSystemId, sourceMapSystemId),
          ),
        ),
      ),
    )
    .limit(1);
  if (existing) return { mapConnectionId: existing.id, payload: null };

  let mapConnectionId: bigint | null = null;
  const res = await commitMapEvent({
    mapId,
    characterId,
    kind: 'connection.create',
    tx,
    mutate: async (innerTx) => {
      const [row] = await innerTx
        .insert(apMapConnection)
        .values({
          mapId,
          sourceMapSystemId,
          targetMapSystemId,
          scope: 'wh',
          massStatus: 'fresh',
          jumpMassClass: null,
          eolStage: 'none',
          preserveMass: false,
          isRolling: false,
          eolAt: null,
        })
        .returning({
          id: apMapConnection.id,
          source: apMapConnection.sourceMapSystemId,
          target: apMapConnection.targetMapSystemId,
          scope: apMapConnection.scope,
          massStatus: apMapConnection.massStatus,
          jumpMassClass: apMapConnection.jumpMassClass,
          eolStage: apMapConnection.eolStage,
          preserveMass: apMapConnection.preserveMass,
          isRolling: apMapConnection.isRolling,
          isStatic: apMapConnection.isStatic,
          sourceBubbled: apMapConnection.sourceBubbled,
          targetBubbled: apMapConnection.targetBubbled,
          eolAt: apMapConnection.eolAt,
          createdAt: apMapConnection.createdAt,
        });
      mapConnectionId = row!.id;
      return {
        id: row!.id.toString(),
        source: row!.source.toString(),
        target: row!.target.toString(),
        scope: row!.scope,
        massStatus: row!.massStatus,
        jumpMassClass: row!.jumpMassClass,
        eolStage: row!.eolStage,
        preserveMass: row!.preserveMass,
        isRolling: row!.isRolling,
        isStatic: row!.isStatic,
        sourceBubbled: row!.sourceBubbled,
        targetBubbled: row!.targetBubbled,
        eolAt: row!.eolAt ? row!.eolAt.toISOString() : null,
        createdAt: row!.createdAt.toISOString(),
      };
    },
  });
  if (!res.ok) throw new Error(res.error);
  if (mapConnectionId === null) throw new Error('connection.create returned without a connection id');
  return { mapConnectionId, payload: res.data };
}

/**
 * Post-commit 0121 child-tag follow-up: now that the endpoints + edge are
 * committed, root the target as a child of its source and emit the tag as its
 * own `system.updated`. No-op for ABC / unschemed maps. Best-effort — a tag
 * failure is logged at `warn` and never fails the caller's fold. Runs standalone
 * (its own transaction), so call it only after the outer transaction commits.
 */
export async function tagOnConnect(
  mapId: bigint,
  sourceMapSystemId: bigint,
  targetMapSystemId: bigint,
  characterId: bigint | null,
  payloads: MapEventPayload[],
): Promise<void> {
  try {
    const tagged = await assignTagOnConnect(mapId, sourceMapSystemId, targetMapSystemId);
    if (!tagged) return;
    const upd = await commitMapEvent({
      mapId,
      characterId,
      kind: 'system.updated',
      mutate: async (tx) => {
        await tx
          .update(apMapSystem)
          .set({ tag: tagged.tag, updatedAt: new Date() })
          .where(and(eq(apMapSystem.id, tagged.mapSystemId), eq(apMapSystem.mapId, mapId)));
        return { id: tagged.mapSystemId.toString(), tag: tagged.tag };
      },
    });
    if (upd.ok) payloads.push(upd.data);
  } catch (err) {
    log.warn('auto-tag on connect failed', { mapId: mapId.toString(), err });
  }
}
