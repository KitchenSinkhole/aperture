import 'server-only';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMap, universeKillmail, universeType } from '@/db/schema';
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
  UserApiKill,
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
import { apertureConfig } from '../../../aperture.config';

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
      case 'kills':
        return { data: await projectKills(mapId) };
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
        eolSource: c.eolSource,
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

const victim = (field: 'character_id' | 'corporation_id' | 'alliance_id') =>
  sql<string | null>`${universeKillmail.body} -> 'victim' ->> ${sql.raw(`'${field}'`)}`;
const victimShipTypeId = sql<number | null>`(${universeKillmail.body} -> 'victim' ->> 'ship_type_id')::integer`;

/**
 * The newest `USER_API_KILLS_MAX_LIMIT` cached kills in the map's visible
 * systems within the last `USER_API_KILLS_MAX_AGE_DAYS`, newest first. Any
 * `since` inside that window and any `limit` up to that cap select a prefix
 * of this list, so the serve step can apply both without a second query.
 */
async function projectKills(mapId: bigint): Promise<UserApiKill[]> {
  const systems = await loadVisibleMapSystems(mapId);
  if (systems.length === 0) return [];
  const bySystemId = new Map(systems.map((s) => [s.systemId, s]));
  const floor = new Date(Date.now() - apertureConfig.USER_API_KILLS_MAX_AGE_DAYS * 86_400_000);

  const rows = await db
    .select({
      id: universeKillmail.id,
      killmailTime: universeKillmail.killmailTime,
      solarSystemId: universeKillmail.solarSystemId,
      totalValue: universeKillmail.totalValue,
      shipTypeId: victimShipTypeId,
      shipTypeName: universeType.name,
      victimCharacterId: victim('character_id'),
      victimCorporationId: victim('corporation_id'),
      victimAllianceId: victim('alliance_id'),
      attackerCount: sql<number>`coalesce(jsonb_array_length(${universeKillmail.body} -> 'attackers'), 0)`,
    })
    .from(universeKillmail)
    .leftJoin(universeType, eq(universeType.id, victimShipTypeId))
    .where(
      and(
        inArray(universeKillmail.solarSystemId, [...bySystemId.keys()]),
        gte(universeKillmail.killmailTime, floor),
      ),
    )
    .orderBy(desc(universeKillmail.killmailTime), desc(universeKillmail.id))
    .limit(apertureConfig.USER_API_KILLS_MAX_LIMIT);

  return rows.flatMap((k): UserApiKill[] => {
    const system = k.solarSystemId === null ? undefined : bySystemId.get(k.solarSystemId);
    if (!system) return [];
    return [{
      killmailId: k.id.toString(),
      killmailTime: k.killmailTime.toISOString(),
      mapSystemId: system.id,
      systemId: system.systemId,
      systemName: system.name,
      shipTypeId: k.shipTypeId,
      shipTypeName: k.shipTypeName,
      victimCharacterId: k.victimCharacterId,
      victimCorporationId: k.victimCorporationId,
      victimAllianceId: k.victimAllianceId,
      attackerCount: Number(k.attackerCount),
      totalValue: k.totalValue,
    }];
  });
}
