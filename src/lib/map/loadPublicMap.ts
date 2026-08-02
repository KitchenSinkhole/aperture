import 'server-only';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapSignature,
  apMapSystem,
  connectionScope,
  eolStage,
  signatureClassKind,
  signatureGroupKey,
  systemStatus,
  universeConstellation,
  universeRegion,
  universeSystem,
  universeWormhole,
  whJumpMass,
  whMass,
} from '@/db/schema';
import type { ShipClass } from '@/types';
import { apertureConfig } from '../../../aperture.config';
import { loadMapPresence, loadStatics } from './loadMap';
import { derivePublicEntrances, type PublicMapEntrance } from './publicEntrances';
import { resolveShareToken } from './share';

type SystemStatus = (typeof systemStatus.enumValues)[number];
type ConnectionScope = (typeof connectionScope.enumValues)[number];
type EolStage = (typeof eolStage.enumValues)[number];
type WhMass = (typeof whMass.enumValues)[number];
type WhJumpMass = (typeof whJumpMass.enumValues)[number];
type SignatureGroupKey = (typeof signatureGroupKey.enumValues)[number];
type SignatureClassKind = (typeof signatureClassKind.enumValues)[number];

const HUB_NAME_BY_ID = new Map<number, string>(
  apertureConfig.ROUTE_HUBS.map((h) => [h.systemId, h.name]),
);

/**
 * A visible system on a publicly-shared map. Structurally cannot carry
 * `alias`, `intelNotes`, lock state, or `rallyAt` — those fields simply do
 * not exist on this type, so no later refactor can leak them here.
 */
export type PublicMapSystemNode = {
  id: string;
  systemId: number;
  name: string;
  tag: string | null;
  status: SystemStatus;
  security: string | null;
  trueSec: number | null;
  effect: string | null;
  regionName: string;
  constellationName: string;
  statics: { label: string; typeId: number }[];
  tradeHub: { name: string; jumps: number } | null;
  /** The map's designated Home. A guest reads the chain from it, so it is published. */
  isHome: boolean;
  positionX: number;
  positionY: number;
};

/**
 * A connection on a publicly-shared map. `sigIds` is a nullable object
 * rather than two nullable strings so a consumer can distinguish "this token
 * doesn't publish endpoint codes" (`null`) from "this end hasn't been
 * scanned" (`{ source: null, target: '...' }`).
 */
export type PublicMapConnectionEdge = {
  id: string;
  source: string;
  target: string;
  scope: ConnectionScope;
  massStatus: WhMass;
  jumpMassClass: WhJumpMass | null;
  eolStage: EolStage;
  preserveMass: boolean;
  isRolling: boolean;
  isStatic: boolean;
  eolAt: string | null;
  createdAt: string;
  sigIds: { source: string | null; target: string | null } | null;
};

/**
 * A scan signature on a publicly-shared map. Carries no `description`
 * (freeform operator notes) or `activityOverride` (a manual operator
 * judgement) — both are intel, not chain structure.
 */
export type PublicMapSignature = {
  id: string;
  mapSystemId: string;
  mapConnectionId: string | null;
  sigId: string;
  groupKey: SignatureGroupKey | null;
  classKind: SignatureClassKind | null;
  typeId: number | null;
  wormholeCode: string | null;
  name: string | null;
  eolStage: EolStage;
  expiresAt: string;
  createdAt: string;
};

export type PublicPresenceSystemCount = {
  systemId: number;
  count: number;
  byClass: { shipClass: ShipClass; count: number }[];
};

export type PublicPresencePilot = {
  characterId: number;
  characterName: string;
  systemId: number;
  systemName: string | null;
  systemSecurity: string | null;
  systemTrueSec: number | null;
  shipTypeId: number | null;
  shipTypeName: string | null;
  shipClass: ShipClass | null;
  shipName: string | null;
  locationAt: string;
};

/**
 * The redacted pilot-presence projection for a public share, keyed to the
 * token's `presenceMode`. A discriminated union so "no character name
 * outside `full`" is enforced by the type, not a runtime check.
 */
export type PublicMapPresence =
  | { mode: 'none' }
  | { mode: 'anonymous'; systems: PublicPresenceSystemCount[] }
  | { mode: 'full'; pilots: PublicPresencePilot[] };

/** Everything an anonymous share-token viewer may see. No `id`, `scope`, `type`, `notes`, `intel`, `structures`, or stats. */
export type PublicMapViewData = {
  map: { name: string; shareLabel: string };
  systems: PublicMapSystemNode[];
  connections: PublicMapConnectionEdge[];
  /** `null` when the token doesn't publish signatures; `[]` when it does and there are none. */
  signatures: PublicMapSignature[] | null;
  presence: PublicMapPresence;
  /** The k-space ways into the chain, derived from `systems` and `connections`. */
  entrances: PublicMapEntrance[];
};

/**
 * Turns a raw share token into exactly the data an anonymous spectator may
 * see, or `null` when the token is unknown, expired, revoked, or its parent
 * map is soft-deleted (every case `resolveShareToken` already collapses to
 * `null`). This is a separate function from `loadMapForView` by design
 * (design invariant 2) — there is no synthetic anonymous character, and the
 * projection is viewer-independent so one result can be cached and served to
 * every viewer of the token (design invariant 5).
 */
export async function loadPublicMapView(token: string): Promise<PublicMapViewData | null> {
  const resolved = await resolveShareToken(token);
  if (!resolved) return null;
  const { mapId, label, profile } = resolved;

  const [map] = await db
    .select({ name: apMap.name, homeMapSystemId: apMap.homeMapSystemId })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  if (!map) return null;

  const systemRows = await db
    .select({
      id: apMapSystem.id,
      systemId: apMapSystem.systemId,
      tag: apMapSystem.tag,
      status: apMapSystem.status,
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
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.visible, true)))
    .orderBy(apMapSystem.id);

  const staticsBySystem = await loadStatics(systemRows.map((s) => s.systemId));
  const visibleSystemIds = systemRows.map((s) => s.id);
  const visibleEveSystemIds = new Set(systemRows.map((s) => s.systemId));

  const connectionRows = visibleSystemIds.length
    ? await db
        .select({
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
        })
        .from(apMapConnection)
        .where(
          and(
            eq(apMapConnection.mapId, mapId),
            inArray(apMapConnection.sourceMapSystemId, visibleSystemIds),
            inArray(apMapConnection.targetMapSystemId, visibleSystemIds),
            isNotNull(apMapConnection.confirmedAt),
          ),
        )
        .orderBy(apMapConnection.id)
    : [];

  const sigIdsByConnection = profile.showConnectionSigIds
    ? await loadConnectionSigIds(
        connectionRows.filter((c) => c.scope === 'wh'),
      )
    : new Map<string, { source: string | null; target: string | null }>();

  const signatures = profile.showSignatures
    ? await loadPublicSignatures(visibleSystemIds)
    : null;

  const presence = await loadPublicPresence(mapId, profile.presenceMode, visibleEveSystemIds);

  const systems: PublicMapSystemNode[] = systemRows.map((s) => ({
    id: s.id.toString(),
    systemId: s.systemId,
    name: s.name,
    tag: s.tag,
    status: s.status,
    security: s.security,
    trueSec: s.trueSec,
    effect: s.effect,
    regionName: s.regionName,
    constellationName: s.constellationName,
    statics: staticsBySystem.get(s.systemId)?.display ?? [],
    tradeHub:
      s.nearestTradeHubId != null && s.nearestTradeHubJumps != null
        ? {
            name: HUB_NAME_BY_ID.get(s.nearestTradeHubId) ?? 'trade hub',
            jumps: s.nearestTradeHubJumps,
          }
        : null,
    isHome: map.homeMapSystemId !== null && s.id === map.homeMapSystemId,
    positionX: s.positionX,
    positionY: s.positionY,
  }));

  const connections: PublicMapConnectionEdge[] = connectionRows.map((c) => ({
    id: c.id.toString(),
    source: c.source.toString(),
    target: c.target.toString(),
    scope: c.scope,
    massStatus: c.massStatus,
    jumpMassClass: c.jumpMassClass,
    eolStage: c.eolStage,
    preserveMass: c.preserveMass,
    isRolling: c.isRolling,
    isStatic: c.isStatic,
    eolAt: c.eolAt ? c.eolAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    sigIds:
      c.scope === 'wh' && profile.showConnectionSigIds
        ? (sigIdsByConnection.get(c.id.toString()) ?? { source: null, target: null })
        : null,
  }));

  return {
    map: { name: map.name, shareLabel: label },
    systems,
    connections,
    signatures,
    presence,
    entrances: await derivePublicEntrances(
      systems,
      connections,
      map.homeMapSystemId === null ? null : map.homeMapSystemId.toString(),
    ),
  };
}

/**
 * Maps each `wh` connection id to its two endpoint sig codes, derived from
 * `ap_map_signature` rows bound to that connection. A row's `mapSystemId`
 * says which endpoint it belongs to; either side may be legitimately absent
 * when the far side hasn't been pasted yet.
 */
async function loadConnectionSigIds(
  whConnections: { id: bigint; source: bigint; target: bigint }[],
): Promise<Map<string, { source: string | null; target: string | null }>> {
  const result = new Map<string, { source: string | null; target: string | null }>();
  if (whConnections.length === 0) return result;

  const endpointsByConnection = new Map(
    whConnections.map((c) => [c.id.toString(), { source: c.source, target: c.target }]),
  );

  const rows = await db
    .select({
      mapConnectionId: apMapSignature.mapConnectionId,
      mapSystemId: apMapSignature.mapSystemId,
      sigId: apMapSignature.sigId,
    })
    .from(apMapSignature)
    .where(
      inArray(
        apMapSignature.mapConnectionId,
        whConnections.map((c) => c.id),
      ),
    );

  for (const row of rows) {
    if (row.mapConnectionId === null) continue;
    const key = row.mapConnectionId.toString();
    const endpoints = endpointsByConnection.get(key);
    if (!endpoints) continue;
    const entry = result.get(key) ?? { source: null, target: null };
    if (row.mapSystemId === endpoints.source) entry.source = row.sigId;
    else if (row.mapSystemId === endpoints.target) entry.target = row.sigId;
    result.set(key, entry);
  }
  return result;
}

/** The full-signature projection, minus `description` and `activityOverride`. */
async function loadPublicSignatures(mapSystemIds: bigint[]): Promise<PublicMapSignature[]> {
  if (mapSystemIds.length === 0) return [];
  const rows = await db
    .select({
      id: apMapSignature.id,
      mapSystemId: apMapSignature.mapSystemId,
      mapConnectionId: apMapSignature.mapConnectionId,
      sigId: apMapSignature.sigId,
      groupKey: apMapSignature.groupKey,
      classKind: apMapSignature.classKind,
      typeId: apMapSignature.typeId,
      name: apMapSignature.name,
      eolStage: apMapSignature.eolStage,
      expiresAt: apMapSignature.expiresAt,
      createdAt: apMapSignature.createdAt,
      wormholeCode: universeWormhole.name,
    })
    .from(apMapSignature)
    .leftJoin(universeWormhole, eq(apMapSignature.typeId, universeWormhole.typeId))
    .where(inArray(apMapSignature.mapSystemId, mapSystemIds))
    .orderBy(apMapSignature.sigId);

  return rows.map((r) => ({
    id: r.id.toString(),
    mapSystemId: r.mapSystemId.toString(),
    mapConnectionId: r.mapConnectionId === null ? null : r.mapConnectionId.toString(),
    sigId: r.sigId,
    groupKey: r.groupKey,
    classKind: r.classKind,
    typeId: r.typeId,
    wormholeCode: r.wormholeCode,
    name: r.name,
    eolStage: r.eolStage,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Projects `loadMapPresence` down to the token's `presenceMode`, filtered to
 * pilots in systems actually visible on the map — a tracked pilot elsewhere
 * (not on this map at all) must not leak through a public share.
 */
async function loadPublicPresence(
  mapId: bigint,
  presenceMode: 'none' | 'anonymous' | 'full',
  visibleEveSystemIds: Set<number>,
): Promise<PublicMapPresence> {
  if (presenceMode === 'none') return { mode: 'none' };

  const roster = (await loadMapPresence(mapId)).filter((p) => visibleEveSystemIds.has(p.systemId));

  if (presenceMode === 'full') {
    return {
      mode: 'full',
      pilots: roster.map((p) => ({
        characterId: p.characterId,
        characterName: p.characterName,
        systemId: p.systemId,
        systemName: p.systemName,
        systemSecurity: p.systemSecurity,
        systemTrueSec: p.systemTrueSec,
        shipTypeId: p.shipTypeId,
        shipTypeName: p.shipTypeName,
        shipClass: p.shipClass,
        shipName: p.shipName,
        locationAt: p.locationAt,
      })),
    };
  }

  const bySystem = new Map<number, { count: number; byClass: Map<ShipClass, number> }>();
  for (const p of roster) {
    const entry = bySystem.get(p.systemId) ?? { count: 0, byClass: new Map<ShipClass, number>() };
    entry.count += 1;
    if (p.shipClass) entry.byClass.set(p.shipClass, (entry.byClass.get(p.shipClass) ?? 0) + 1);
    bySystem.set(p.systemId, entry);
  }
  return {
    mode: 'anonymous',
    systems: [...bySystem.entries()].map(([systemId, entry]) => ({
      systemId,
      count: entry.count,
      byClass: [...entry.byClass.entries()].map(([shipClass, count]) => ({ shipClass, count })),
    })),
  };
}

