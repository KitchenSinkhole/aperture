import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  apMapSignature,
  apMapSystem,
  universeConstellation,
  universeRegion,
  universeSystem,
  universeSystemStatic,
  universeWormhole,
} from '@/db/schema';
import type { MapEventPatch } from '@/lib/realtime/protocol';
import { apertureConfig } from '../../../aperture.config';

const HUB_NAME_BY_ID = new Map<number, string>(
  apertureConfig.ROUTE_HUBS.map((h) => [h.systemId, h.name]),
);

// No `import 'server-only'`: pure read-side helper, consumed by both the
// user-driven mutation wrappers (`src/lib/map/mutations/systems.ts`, which DOES
// carry the guard) and by job code (`src/lib/jobs/locationCommit.ts`)
// that runs under plain Node and would crash on the `server-only/index.js`
// throw. Same precedent as `commitMapEvent`.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Re-read a placed system flattened with its universe metadata + statics — the
 * full `system.added` event body the canvas needs to render the node without a
 * follow-up fetch. Used inside a `commitMapEvent` `mutate` callback (so the
 * inserted row is visible) and shaped to match `mapEventPayloadSchema`.
 */
export async function buildSystemNode(
  tx: Tx,
  mapSystemId: bigint,
): Promise<MapEventPatch<'system.added'>> {
  const [row] = await tx
    .select({
      id: apMapSystem.id,
      systemId: apMapSystem.systemId,
      alias: apMapSystem.alias,
      tag: apMapSystem.tag,
      intelNotes: apMapSystem.intelNotes,
      status: apMapSystem.status,
      locked: apMapSystem.locked,
      rallyAt: apMapSystem.rallyAt,
      positionX: apMapSystem.positionX,
      positionY: apMapSystem.positionY,
      name: universeSystem.name,
      security: universeSystem.security,
      trueSec: universeSystem.trueSec,
      effect: universeSystem.effect,
      nearestTradeHubId: universeSystem.nearestTradeHubId,
      nearestTradeHubJumps: universeSystem.nearestTradeHubJumps,
      constellationName: universeConstellation.name,
      regionName: universeRegion.name,
    })
    .from(apMapSystem)
    .innerJoin(universeSystem, eq(apMapSystem.systemId, universeSystem.id))
    .innerJoin(universeConstellation, eq(universeSystem.constellationId, universeConstellation.id))
    .innerJoin(universeRegion, eq(universeConstellation.regionId, universeRegion.id))
    .where(eq(apMapSystem.id, mapSystemId));
  if (!row) throw new Error('System row vanished mid-transaction.');

  const staticRows = await tx
    .select({ name: universeWormhole.name, targetClass: universeWormhole.targetClass })
    .from(universeSystemStatic)
    .innerJoin(universeWormhole, eq(universeSystemStatic.typeId, universeWormhole.typeId))
    .where(eq(universeSystemStatic.systemId, row.systemId));

  // Surviving signatures ride the event so re-adding a soft-removed system
  // re-hydrates its sigs on every tab without a reload. Brand-new adds return [].
  // Mirrors the signature load in `loadMapForView` (left-join for `wormholeCode`).
  const signatureRows = await tx
    .select({
      id: apMapSignature.id,
      mapSystemId: apMapSignature.mapSystemId,
      mapConnectionId: apMapSignature.mapConnectionId,
      sigId: apMapSignature.sigId,
      groupKey: apMapSignature.groupKey,
      typeId: apMapSignature.typeId,
      wormholeCode: universeWormhole.name,
      name: apMapSignature.name,
      description: apMapSignature.description,
      expiresAt: apMapSignature.expiresAt,
      createdAt: apMapSignature.createdAt,
      updatedAt: apMapSignature.updatedAt,
    })
    .from(apMapSignature)
    .leftJoin(universeWormhole, eq(apMapSignature.typeId, universeWormhole.typeId))
    .where(eq(apMapSignature.mapSystemId, mapSystemId))
    .orderBy(apMapSignature.sigId);

  return {
    id: row.id.toString(),
    systemId: row.systemId,
    name: row.name,
    alias: row.alias,
    tag: row.tag,
    intelNotes: row.intelNotes,
    status: row.status,
    security: row.security,
    trueSec: row.trueSec,
    effect: row.effect,
    regionName: row.regionName,
    constellationName: row.constellationName,
    // Resolve to the far-side system class (matches loadMap's loadStatics);
    // fall back to the raw WH code only when the class is unknown (K162-style).
    statics: staticRows.map((s) => s.targetClass ?? s.name).filter((c): c is string => !!c),
    tradeHub:
      row.nearestTradeHubId != null && row.nearestTradeHubJumps != null
        ? {
            name: HUB_NAME_BY_ID.get(row.nearestTradeHubId) ?? 'trade hub',
            jumps: row.nearestTradeHubJumps,
          }
        : null,
    locked: row.locked,
    rallyAt: row.rallyAt ? row.rallyAt.toISOString() : null,
    positionX: row.positionX,
    positionY: row.positionY,
    signatures: signatureRows.map((s) => ({
      id: s.id.toString(),
      mapSystemId: s.mapSystemId.toString(),
      mapConnectionId: s.mapConnectionId ? s.mapConnectionId.toString() : null,
      sigId: s.sigId,
      groupKey: s.groupKey,
      typeId: s.typeId,
      wormholeCode: s.wormholeCode,
      name: s.name,
      description: s.description,
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  };
}
