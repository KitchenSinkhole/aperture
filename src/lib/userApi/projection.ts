import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMap } from '@/db/schema';
import { isBlackedOut } from '@/lib/auth/blackout';
import { listMapConnectionMassLog } from '@/lib/map/connectionMassLog';
import {
  loadMapNotes,
  loadMapPresence,
  loadVisibleMapConnections,
  loadVisibleMapSystems,
} from '@/lib/map/loadMap';
import { loadSignaturesForSystems } from '@/lib/map/systemNode';
import type {
  BlackoutViewer,
  MapSystemNode,
  UserApiConnection,
  UserApiMap,
  UserApiMassLogEntry,
  UserApiNotes,
  UserApiPayload,
  UserApiPilot,
  UserApiProjectionData,
  UserApiResource,
  UserApiSignature,
  UserApiSystem,
} from '@/types';

/**
 * The user API's read projections: each resource as its own wire DTO, built
 * from the same viewer-independent loaders `loadMapForView` uses, so the
 * visibility predicates are shared rather than restated. The DTOs are mapped
 * field by field so a change to the in-app view model cannot change the wire
 * contract.
 *
 * No access check here: the request pipeline has already authorised the token.
 */

const toId = (n: number | null): string | null => (n === null ? null : String(n));

/**
 * One resource of one map, as the token owner `viewer` may see it. `viewer`
 * matters only to `pilots` and `mass_log`. `map` throws when the map row is
 * gone or soft-deleted, so a deletion racing the auth cache fails rather than
 * serving an empty map.
 */
export async function loadUserApiProjection<R extends UserApiResource>(
  mapId: bigint,
  resource: R,
  viewer: BlackoutViewer,
): Promise<UserApiPayload<R>> {
  const payload = await (async (): Promise<UserApiPayload> => {
    switch (resource) {
      case 'map':
        return { data: await projectMap(mapId) };
      case 'signatures':
        return { data: await projectSignatures(mapId) };
      case 'pilots':
        return { data: await projectPilots(mapId, viewer) };
      case 'notes':
        return { data: await projectNotes(mapId) };
      case 'mass_log':
        if (isBlackedOut(viewer)) return { data: [], hidden: true };
        return { data: await projectMassLog(mapId) };
    }
    throw new Error(`Unknown user API resource: ${String(resource)}`);
  })();
  return payload as UserApiPayload<R>;
}

async function projectMap(mapId: bigint): Promise<UserApiProjectionData['map']> {
  const [map] = await db
    .select({
      id: apMap.id,
      name: apMap.name,
      scope: apMap.scope,
      type: apMap.type,
      homeMapSystemId: apMap.homeMapSystemId,
    })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  if (!map) throw new Error(`User API projection: map ${mapId.toString()} not found.`);

  const systems = await loadVisibleMapSystems(mapId);
  const connections = await loadVisibleMapConnections(mapId, systemIds(systems));
  const result: UserApiMap = {
    map: {
      id: map.id.toString(),
      name: map.name,
      scope: map.scope,
      type: map.type,
      homeMapSystemId: map.homeMapSystemId === null ? null : map.homeMapSystemId.toString(),
    },
    systems: systems.map(toSystem),
    connections: connections.map(
      (c): UserApiConnection => ({
        id: c.id,
        source: c.source,
        target: c.target,
        scope: c.scope,
        massStatus: c.massStatus,
        jumpMassClass: c.jumpMassClass,
        eolStage: c.eolStage,
        eolAt: c.eolAt,
        preserveMass: c.preserveMass,
        isRolling: c.isRolling,
        isStatic: c.isStatic,
        sourceBubbled: c.sourceBubbled,
        targetBubbled: c.targetBubbled,
        createdAt: c.createdAt,
      }),
    ),
  };
  return result;
}

function toSystem(s: MapSystemNode): UserApiSystem {
  return {
    id: s.id,
    systemId: s.systemId,
    name: s.name,
    alias: s.alias,
    tag: s.tag,
    status: s.status,
    security: s.security,
    trueSec: s.trueSec,
    effect: s.effect,
    regionName: s.regionName,
    constellationName: s.constellationName,
    statics: s.statics.map((st) => ({ label: st.label, typeId: st.typeId })),
    tradeHub: s.tradeHub ? { name: s.tradeHub.name, jumps: s.tradeHub.jumps } : null,
    locked: s.locked,
    lockedByCharacterId: toId(s.lockedByCharacterId),
    lockedByName: s.lockedByName,
    rallyAt: s.rallyAt,
    positionX: s.positionX,
    positionY: s.positionY,
  };
}

function systemIds(systems: MapSystemNode[]): bigint[] {
  return systems.map((s) => BigInt(s.id));
}

async function projectSignatures(mapId: bigint): Promise<UserApiSignature[]> {
  const systems = await loadVisibleMapSystems(mapId);
  const byId = new Map(systems.map((s) => [s.id, s]));
  const signatures = await loadSignaturesForSystems(systemIds(systems));
  return signatures.flatMap((sig): UserApiSignature[] => {
    const system = byId.get(sig.mapSystemId);
    if (!system) return [];
    return [{
      id: sig.id,
      mapSystemId: sig.mapSystemId,
      systemId: system.systemId,
      systemName: system.name,
      connectionId: sig.mapConnectionId,
      sigId: sig.sigId,
      groupKey: sig.groupKey,
      classKind: sig.classKind,
      activityOverride: sig.activityOverride,
      typeId: sig.typeId,
      wormholeCode: sig.wormholeCode,
      name: sig.name,
      description: sig.description,
      eolStage: sig.eolStage,
      expiresAt: sig.expiresAt,
      createdAt: sig.createdAt,
      updatedAt: sig.updatedAt,
    }];
  });
}

async function projectPilots(mapId: bigint, viewer: BlackoutViewer): Promise<UserApiPilot[]> {
  const presence = await loadMapPresence(mapId, viewer);
  return presence.map((p) => ({
    characterId: String(p.characterId),
    characterName: p.characterName,
    mainCharacterId: toId(p.mainCharacterId),
    mainCharacterName: p.mainCharacterName,
    systemId: p.systemId,
    systemName: p.systemName,
    systemSecurity: p.systemSecurity,
    systemTrueSec: p.systemTrueSec,
    shipTypeId: p.shipTypeId,
    shipTypeName: p.shipTypeName,
    shipClass: p.shipClass,
    shipName: p.shipName,
    locationAt: p.locationAt,
  }));
}

async function projectNotes(mapId: bigint): Promise<UserApiNotes> {
  const notes = await loadMapNotes(mapId);
  const systems = await loadVisibleMapSystems(mapId);
  return {
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      severity: n.severity,
      locked: n.locked,
      positionX: n.positionX,
      positionY: n.positionY,
      createdByCharacterId: toId(n.createdByCharacterId),
      createdByName: n.createdByName,
      lastEditedByCharacterId: toId(n.lastEditedByCharacterId),
      lastEditedByName: n.lastEditedByName,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
    systemNotes: systems.flatMap((s) =>
      s.intelNotes
        ? [{ mapSystemId: s.id, systemId: s.systemId, systemName: s.name, intelNotes: s.intelNotes }]
        : [],
    ),
  };
}

async function projectMassLog(mapId: bigint): Promise<UserApiMassLogEntry[]> {
  const systems = await loadVisibleMapSystems(mapId);
  const eveIdByMapSystem = new Map(systems.map((s) => [s.id, s.systemId]));
  const connections = await loadVisibleMapConnections(mapId, systemIds(systems));
  const ends = new Map(
    connections.map((c) => [
      c.id,
      { source: eveIdByMapSystem.get(c.source)!, target: eveIdByMapSystem.get(c.target)! },
    ]),
  );
  const entries = await listMapConnectionMassLog({
    mapId,
    connectionIds: connections.map((c) => BigInt(c.id)),
  });
  return entries.flatMap((e): UserApiMassLogEntry[] => {
    const end = ends.get(e.connectionId);
    if (!end) return [];
    return [{
      id: e.id,
      connectionId: e.connectionId,
      sourceSystemId: end.source,
      targetSystemId: end.target,
      characterId: e.characterId,
      characterName: e.characterName,
      shipTypeId: e.shipTypeId,
      shipTypeName: e.shipTypeName,
      mass: e.mass,
      cumulativeMass: e.cumulativeMass,
      jumpedAt: e.jumpedAt,
    }];
  });
}
