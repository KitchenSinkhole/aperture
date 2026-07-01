import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapConnection, apMapSystem } from '@/db/schema';
import { commitMapEvent } from '@/lib/map/mutations/core';
import { buildSystemNode } from '@/lib/map/systemNode';
import { findOpenPosition, type Point } from '@/lib/map/placement';
import { assignTagOnAdd, assignTagOnConnect } from '@/lib/tagging/service';
import { getLogger } from '@/lib/log/logger';

const jobLog = getLogger('job');

/**
 * The per-map fold for a detected wormhole jump from the
 * location-poll. Wraps the three `commitMapEvent` calls that turn
 * "character moved from system A to system B" into the same set of events a
 * user-driven `addSystem` + `addSystem` + `createConnection` would produce —
 * minus the events that would be redundant.
 *
 * Idempotency rules:
 *   - If a `ap_map_system` row already exists with `visible = true`, no
 *     `system.added` event is emitted (the system is already on the canvas).
 *   - If a `ap_map_connection` already links the two endpoints in either
 *     direction, no `connection.create` event is emitted (the operator may
 *     have placed it manually, or a prior poll tick already laid it down).
 *
 * Each commit is its own transaction. A failure between
 * commits leaves a consistent state — the next poll tick will skip the parts
 * that succeeded and retry the parts that didn't.
 *
 * `addNewSystems` gates whether a jump may introduce a *new* system to the
 * map. It is `true` only when the moving pilot's account currently has this map
 * open (the caller resolves that from the live WS viewer roster). When `false`
 * the fold never makes a non-visible system visible — it records the connection
 * and breadcrumb only between systems already on the map, so a pilot day-tripping
 * with Aperture closed doesn't pollute a dormant map with every hole they transit.
 */

export interface FoldArgs {
  mapId: bigint;
  characterId: bigint;
  fromSystemId: number;
  toSystemId: number;
  /** Whether this jump may add a system not already on the map (pilot has the map open). */
  addNewSystems: boolean;
}

export interface FoldResult {
  mapId: bigint;
  fromSystemAdded: boolean;
  toSystemAdded: boolean;
  connectionCreated: boolean;
  /**
   * The connection the pilot traversed — created or pre-existing. Used by the
   * mass-log. `null` when the jump was suppressed (`addNewSystems = false` and an
   * endpoint isn't on the map): there's no connection to log against.
   */
  connectionId: bigint | null;
}

export async function foldWormholeJumpOntoMap(args: FoldArgs): Promise<FoldResult> {
  // Pilot has the map closed: never add a new system. Only record movement
  // between two systems already visible on the map; skip the jump entirely
  // when either endpoint isn't there yet.
  if (!args.addNewSystems) {
    const fromMapSystemId = await visibleMapSystemId(args.mapId, args.fromSystemId);
    const toMapSystemId = await visibleMapSystemId(args.mapId, args.toSystemId);
    if (fromMapSystemId === null || toMapSystemId === null) {
      return {
        mapId: args.mapId,
        fromSystemAdded: false,
        toSystemAdded: false,
        connectionCreated: false,
        connectionId: null,
      };
    }
    const connection = await ensureConnection(
      args.mapId,
      fromMapSystemId,
      toMapSystemId,
      args.characterId,
    );
    await tagOnJump(args.mapId, fromMapSystemId, toMapSystemId, args.characterId);
    return {
      mapId: args.mapId,
      fromSystemAdded: false,
      toSystemAdded: false,
      connectionCreated: connection.created,
      connectionId: connection.connectionId,
    };
  }

  const fromOutcome = await ensureSystemVisible(args.mapId, args.fromSystemId, args.characterId);
  // Anchor the destination on the system the pilot came from so a fresh insert
  // fans off the parent's real position instead of piling up at (0,0).
  const toOutcome = await ensureSystemVisible(args.mapId, args.toSystemId, args.characterId, {
    anchorSystemId: args.fromSystemId,
  });
  const connection = await ensureConnection(
    args.mapId,
    fromOutcome.mapSystemId,
    toOutcome.mapSystemId,
    args.characterId,
  );
  // Auto-tagging. On a 0121 map the jump roots the destination as
  // a child of the system the pilot came from; tag it as a separate
  // `system.updated`. Run whether or not the edge was newly created (a prior
  // tick may have laid the edge before either side was tagged). No-op for ABC
  // (already tagged at add) and unscheme'd maps.
  await tagOnJump(args.mapId, fromOutcome.mapSystemId, toOutcome.mapSystemId, args.characterId);
  return {
    mapId: args.mapId,
    fromSystemAdded: fromOutcome.emitted,
    toSystemAdded: toOutcome.emitted,
    connectionCreated: connection.created,
    connectionId: connection.connectionId,
  };
}

/** The `ap_map_system.id` for a system already visible on the map, or `null` if it isn't placed/visible. */
async function visibleMapSystemId(mapId: bigint, systemId: number): Promise<bigint | null> {
  const [row] = await db
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(
      and(
        eq(apMapSystem.mapId, mapId),
        eq(apMapSystem.systemId, systemId),
        eq(apMapSystem.visible, true),
      ),
    );
  return row?.id ?? null;
}

interface EnsureSystemOutcome {
  mapSystemId: bigint;
  emitted: boolean;
}

async function ensureSystemVisible(
  mapId: bigint,
  systemId: number,
  characterId: bigint,
  opts?: { anchorSystemId?: number },
): Promise<EnsureSystemOutcome> {
  const [existing] = await db
    .select({ id: apMapSystem.id, visible: apMapSystem.visible })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, systemId)));
  if (existing?.visible) {
    return { mapSystemId: existing.id, emitted: false };
  }

  // A hidden re-add is a brand-new appearance in a (usually) different chain, so
  // its old coordinates are stale — recompute placement anchored on the system the
  // pilot came from, same as a first-time insert. Metadata (alias/tag/status/intel)
  // still rides through the `onConflictDoUpdate` path untouched.
  const placement = await computePlacement(mapId, opts?.anchorSystemId);

  let mapSystemId: bigint | null = null;
  const result = await commitMapEvent({
    mapId,
    characterId,
    kind: 'system.added',
    mutate: async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(apMapSystem)
        .values({
          mapId,
          systemId,
          visible: true,
          positionX: placement.x,
          positionY: placement.y,
        })
        .onConflictDoUpdate({
          target: [apMapSystem.mapId, apMapSystem.systemId],
          // Preserve alias/tag/status/intel on a re-add, but re-place the node:
          // the old coordinates belong to a prior, now-defunct chain.
          set: {
            visible: true,
            lastVisibleAt: now,
            updatedAt: now,
            positionX: placement.x,
            positionY: placement.y,
          },
        })
        .returning({ id: apMapSystem.id });
      mapSystemId = row!.id;
      // Auto-tagging: ABC tags here so it rides in `system.added`;
      // 0121 clears any preserved tag and re-tags on the connection below.
      await assignTagOnAdd(tx, mapId, row!.id);
      return buildSystemNode(tx, row!.id);
    },
  });
  if (!result.ok) throw new Error(`Failed to add system ${systemId} to map ${mapId}: ${result.error}`);
  if (mapSystemId === null) throw new Error('system.added returned without a map_system id');
  return { mapSystemId, emitted: true };
}

/**
 * Pick a grid-aligned, non-overlapping slot for a brand-new system. Anchors on
 * `anchorSystemId`'s position when it is visible (so the destination fans off the
 * system the pilot came from), else on the centroid of the visible systems, else
 * the origin for an empty map.
 */
async function computePlacement(
  mapId: bigint,
  anchorSystemId?: number,
): Promise<Point> {
  const visible = await db
    .select({ systemId: apMapSystem.systemId, x: apMapSystem.positionX, y: apMapSystem.positionY })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.visible, true)));

  const occupied: Point[] = visible.map((r) => ({ x: r.x, y: r.y }));

  let anchor: Point;
  const anchorRow =
    anchorSystemId !== undefined ? visible.find((r) => r.systemId === anchorSystemId) : undefined;
  if (anchorRow) {
    anchor = { x: anchorRow.x, y: anchorRow.y };
  } else if (occupied.length > 0) {
    anchor = {
      x: occupied.reduce((sum, p) => sum + p.x, 0) / occupied.length,
      y: occupied.reduce((sum, p) => sum + p.y, 0) / occupied.length,
    };
  } else {
    anchor = { x: 0, y: 0 };
  }

  return findOpenPosition(anchor, occupied);
}

interface EnsureConnectionOutcome {
  connectionId: bigint;
  created: boolean;
}

async function ensureConnection(
  mapId: bigint,
  sourceMapSystemId: bigint,
  targetMapSystemId: bigint,
  characterId: bigint,
): Promise<EnsureConnectionOutcome> {
  // Reject self-loop early — the underlying table CHECK constraint would
  // throw, but rejecting here keeps the failure mode obvious in the logs.
  if (sourceMapSystemId === targetMapSystemId) {
    throw new Error(
      `Refusing to fold a self-loop wormhole jump on map ${mapId} (system ${sourceMapSystemId}).`,
    );
  }

  const existing = await db
    .select({ id: apMapConnection.id, confirmedAt: apMapConnection.confirmedAt })
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
  if (existing.length > 0) {
    const row = existing[0]!;
    // A confirmed connection is already on the map — observe-only, no event.
    if (row.confirmedAt !== null) return { connectionId: row.id, created: false };
    // The row is dormant: an endpoint was removed (NULLing confirmed_at) and not
    // restored via the sig path, so the link is hidden. The pilot physically
    // traversing the hole is a fresh observation — re-confirm and re-broadcast as
    // `connection.create` (the client upserts edges by id, so this is idempotent),
    // mirroring restoreConnection. Without this the hole would stay invisible.
    return reconfirmConnection(mapId, row.id, characterId);
  }

  let newConnectionId: bigint | null = null;
  const result = await commitMapEvent({
    mapId,
    characterId,
    kind: 'connection.create',
    mutate: async (tx) => {
      const [row] = await tx
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
          createdAt: sql`now()`,
          updatedAt: sql`now()`,
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
          eolAt: apMapConnection.eolAt,
          createdAt: apMapConnection.createdAt,
        });
      newConnectionId = row!.id;
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
        eolAt: row!.eolAt ? row!.eolAt.toISOString() : null,
        createdAt: row!.createdAt.toISOString(),
      };
    },
  });
  if (!result.ok || newConnectionId === null) {
    throw new Error(
      `Failed to create wormhole connection on map ${mapId}: ${result.ok ? 'no id returned' : result.error}`,
    );
  }
  return { connectionId: newConnectionId, created: true };
}

/**
 * Re-confirm a dormant `wh` connection traversed by a jump: flip `confirmed_at`
 * back to now and re-broadcast the full edge body as `connection.create`. The
 * row keeps its observed WH state (type/mass/EOL/static); we never delete and
 * recreate it (that would cascade the attached signature). Mirrors
 * `restoreConnection`'s re-confirm-and-rebroadcast contract.
 */
async function reconfirmConnection(
  mapId: bigint,
  connectionId: bigint,
  characterId: bigint,
): Promise<EnsureConnectionOutcome> {
  const result = await commitMapEvent({
    mapId,
    characterId,
    kind: 'connection.create',
    mutate: async (tx) => {
      const [row] = await tx
        .update(apMapConnection)
        .set({ confirmedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(apMapConnection.id, connectionId), eq(apMapConnection.mapId, mapId)))
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
          eolAt: apMapConnection.eolAt,
          createdAt: apMapConnection.createdAt,
        });
      if (!row) throw new Error(`Dormant connection ${connectionId} vanished before re-confirm.`);
      return {
        id: row.id.toString(),
        source: row.source.toString(),
        target: row.target.toString(),
        scope: row.scope,
        massStatus: row.massStatus,
        jumpMassClass: row.jumpMassClass,
        eolStage: row.eolStage,
        preserveMass: row.preserveMass,
        isRolling: row.isRolling,
        isStatic: row.isStatic,
        eolAt: row.eolAt ? row.eolAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    },
  });
  if (!result.ok) {
    throw new Error(`Failed to re-confirm dormant connection ${connectionId} on map ${mapId}: ${result.error}`);
  }
  // `created: true` so the caller writes a mass-log entry for the traversal — the
  // hole is freshly back on the map, same as a brand-new fold.
  return { connectionId, created: true };
}

/**
 * After a jump's endpoints + edge are folded, assign the 0121 child
 * tag (if any) as its own `system.updated` event. `systems.ts` carries
 * `'server-only'` and can't be imported here, so the tag write goes through
 * `commitMapEvent` directly. No-op for ABC / unscheme'd maps and when no tag is
 * due. Tagging never blocks the jump fold — failures are logged and swallowed.
 */
async function tagOnJump(
  mapId: bigint,
  fromMapSystemId: bigint,
  toMapSystemId: bigint,
  characterId: bigint,
): Promise<void> {
  try {
    const tagged = await assignTagOnConnect(mapId, fromMapSystemId, toMapSystemId);
    if (!tagged) return;
    await commitMapEvent({
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
  } catch (err) {
    jobLog.warn('auto-tag on jump failed', { mapId: mapId.toString(), err });
  }
}
