import 'server-only';
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapConnection, apMapSystem, universeSystem } from '@/db/schema';
import { fetchEveScoutConnections } from '@/lib/integrations/evescout';
import { assignTagOnAdd, assignTagOnConnect } from '@/lib/tagging/service';
import { getLogger } from '@/lib/log/logger';
import { commitMapEvent, type ActionResult, type Tx } from './mutations/core';
import { buildSystemNode } from './systemNode';
import type { MapEventPayload } from '@/lib/realtime/protocol';

const log = getLogger('server');

/**
 * Thera module backend.
 *
 * `loadTheraConnections` reads EVE-Scout's public Thera/Turnur signature feed
 * (via the EVE-Scout client), orients each row so the shattered hub is the
 * "source" and the connected system is the "target", and enriches the target
 * with its `universe_system.security` class label. A short module-level TTL
 * cache fronts the EVE-Scout fetch so many open maps/tabs don't hammer the
 * public API (no Redis — in-process per CLAUDE.md).
 *
 * `syncTheraConnections` folds chosen connections onto a map. It reuses the
 * `importMapData` shape (one `db.transaction`, N `commitMapEvent` calls sharing
 * the `tx`, returning `MapEventPayload[]` for the initiating client to fold +
 * dedupe) and the `locationCommit` idempotency rules (ensure-visible system,
 * skip the edge if one already links the pair in either direction). Auto-tagging
 * is wired in the same way as the other add/connect pathways: ABC
 * tags ride in `system.added` (via `assignTagOnAdd`), and the 0121 child tag is
 * emitted as a follow-up `system.updated` after the transaction commits (so
 * `assignTagOnConnect` reads the committed topology).
 */

export type TheraHub = 'Thera' | 'Turnur';

export type TheraConnection = {
  hub: TheraHub;
  /** EVE solar-system id of the shattered hub (Thera or Turnur). */
  hubSystemId: number;
  hubName: string;
  /** EVE solar-system id of the connected system. */
  targetSystemId: number;
  targetName: string;
  /** `universe_system.security` label for the target (H/L/0.0/C1–C6/P/A), or null if unseeded. */
  securityClass: string | null;
  signatureId: string | null;
  expiresAt: string | null;
};

const SCOUT_CACHE_TTL_MS = 60_000;
const HUB_GROUP_SPACING = 600;
const TARGET_FAN_RADIUS = 220;

let scoutCache: { at: number; rows: Awaited<ReturnType<typeof fetchEveScoutConnections>> } | null =
  null;

async function cachedScoutRows(): Promise<Awaited<ReturnType<typeof fetchEveScoutConnections>>> {
  if (scoutCache && Date.now() - scoutCache.at < SCOUT_CACHE_TTL_MS) return scoutCache.rows;
  const rows = await fetchEveScoutConnections();
  scoutCache = { at: Date.now(), rows };
  return rows;
}

const HUB_NAME = /thera|turnur/i;

/**
 * Fetch the current EVE-Scout Thera + Turnur connections, oriented + enriched.
 * Throws `EveScoutError` on an EVE-Scout failure (the route maps it to a 502).
 * Rows missing either system id (rare; EVE-Scout occasionally omits an id for an
 * unresolved system) are dropped — they can't be synced to a real `universe_system`.
 */
export async function loadTheraConnections(): Promise<TheraConnection[]> {
  const rows = await cachedScoutRows();

  const oriented = rows
    .filter((r) => r.hub === 'Thera' || r.hub === 'Turnur')
    .map((r) => {
      const sourceIsHub = HUB_NAME.test(r.sourceName);
      const hubSystemId = sourceIsHub ? r.sourceSystemId : r.targetSystemId;
      const targetSystemId = sourceIsHub ? r.targetSystemId : r.sourceSystemId;
      if (hubSystemId == null || targetSystemId == null) return null;
      return {
        hub: r.hub as TheraHub,
        hubSystemId,
        hubName: sourceIsHub ? r.sourceName : r.targetName,
        targetSystemId,
        targetName: sourceIsHub ? r.targetName : r.sourceName,
        signatureId: r.signatureId,
        expiresAt: r.expiresAt,
      };
    })
    .filter((r): r is Omit<TheraConnection, 'securityClass'> => r !== null);

  const targetIds = [...new Set(oriented.map((o) => o.targetSystemId))];
  const securityById = new Map<number, string | null>();
  if (targetIds.length > 0) {
    const secRows = await db
      .select({ id: universeSystem.id, security: universeSystem.security })
      .from(universeSystem)
      .where(inArray(universeSystem.id, targetIds));
    for (const s of secRows) securityById.set(s.id, s.security);
  }

  return oriented.map((o) => ({ ...o, securityClass: securityById.get(o.targetSystemId) ?? null }));
}

export type TheraSyncInput = {
  hubSystemId: number;
  hubName: string;
  targetSystemId: number;
  signatureId?: string | null;
};

export type TheraSyncResult = {
  summary: { systems: number; connections: number };
  payloads: MapEventPayload[];
};

/**
 * Fold the chosen Thera/Turnur connections onto `mapId`. Adds the hub + each
 * target system (if not already visible) and a `wh`/`fresh` connection per pair
 * (if not already present in either direction). Returns the committed event
 * payloads so the initiating client folds them and dedupes its own realtime echo.
 */
export async function syncTheraConnections(args: {
  mapId: bigint;
  characterId: bigint | null;
  connections: TheraSyncInput[];
}): Promise<ActionResult<TheraSyncResult>> {
  const { mapId, characterId } = args;
  try {
    // Group targets by hub so each hub system is ensured once and its targets
    // fan around it.
    const byHub = new Map<number, TheraSyncInput[]>();
    for (const c of args.connections) {
      if (c.hubSystemId === c.targetSystemId) continue;
      const targets = byHub.get(c.hubSystemId) ?? [];
      targets.push(c);
      byHub.set(c.hubSystemId, targets);
    }

    const result = await db.transaction(async (tx) => {
      const payloads: MapEventPayload[] = [];
      const edges: Array<{ source: bigint; target: bigint }> = [];
      let systems = 0;
      let connections = 0;

      let hubIndex = 0;
      for (const [hubSystemId, targets] of byHub) {
        const hubBase = await hubBasePosition(tx, mapId, hubSystemId, hubIndex);
        hubIndex += 1;

        const hub = await ensureSystem(tx, mapId, hubSystemId, characterId, hubBase);
        if (hub.payload) {
          payloads.push(hub.payload);
          systems += 1;
        }

        for (let i = 0; i < targets.length; i += 1) {
          const angle = (2 * Math.PI * i) / targets.length;
          const pos = {
            x: Math.round(hubBase.x + TARGET_FAN_RADIUS * Math.cos(angle)),
            y: Math.round(hubBase.y + TARGET_FAN_RADIUS * Math.sin(angle)),
          };
          const target = await ensureSystem(
            tx,
            mapId,
            targets[i]!.targetSystemId,
            characterId,
            pos,
          );
          if (target.payload) {
            payloads.push(target.payload);
            systems += 1;
          }

          const conn = await ensureConnection(
            tx,
            mapId,
            hub.mapSystemId,
            target.mapSystemId,
            characterId,
          );
          if (conn) {
            payloads.push(conn);
            connections += 1;
          }
          edges.push({ source: hub.mapSystemId, target: target.mapSystemId });
        }
      }

      return { payloads, edges, systems, connections };
    });

    // 0121 follow-up: now that endpoints + edges are committed, root each target
    // as a child of its hub and emit the tag as its own `system.updated`. No-op
    // for ABC / unscheme'd maps. Best-effort — never fail the sync.
    for (const edge of result.edges) {
      await tagOnConnect(mapId, edge.source, edge.target, characterId, result.payloads);
    }

    return {
      ok: true,
      data: {
        summary: { systems: result.systems, connections: result.connections },
        payloads: result.payloads,
      },
      eventId: 0,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Thera sync failed.' };
  }
}

/** Anchor the target fan on the hub's real position if it's already placed, else stagger hub groups. */
async function hubBasePosition(
  tx: Tx,
  mapId: bigint,
  hubSystemId: number,
  hubIndex: number,
): Promise<{ x: number; y: number }> {
  const [row] = await tx
    .select({ x: apMapSystem.positionX, y: apMapSystem.positionY, visible: apMapSystem.visible })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, hubSystemId)));
  if (row?.visible) return { x: row.x, y: row.y };
  return { x: hubIndex * HUB_GROUP_SPACING, y: 0 };
}

type EnsureSystemOutcome = {
  mapSystemId: bigint;
  /** The `system.added` payload when newly added; undefined when already visible. */
  payload?: MapEventPayload;
};

async function ensureSystem(
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

async function ensureConnection(
  tx: Tx,
  mapId: bigint,
  sourceMapSystemId: bigint,
  targetMapSystemId: bigint,
  characterId: bigint | null,
): Promise<MapEventPayload | null> {
  if (sourceMapSystemId === targetMapSystemId) return null;

  const existing = await tx
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
  if (existing.length > 0) return null;

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
          eolAt: apMapConnection.eolAt,
          createdAt: apMapConnection.createdAt,
        });
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
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function tagOnConnect(
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
    log.warn('thera-sync auto-tag on connect failed', { mapId: mapId.toString(), err });
  }
}
