import 'server-only';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapCharacterTracking,
  apMapConnection,
  apMapNote,
  apMapSystem,
  apUser,
  connectionScope,
  eolStage,
  mapNoteSeverity,
  mapScope,
  mapType,
  signatureGroupKey,
  systemStatus,
  tagScheme,
  universeConstellation,
  universeRegion,
  universeSystem,
  universeSystemStatic,
  universeType,
  universeWormhole,
  whJumpMass,
  whMass,
} from '@/db/schema';
import { canViewMap, viewableMapPredicate } from '@/lib/auth/rights';
import { loadSignaturesForSystems } from './systemNode';
import { apertureConfig } from '../../../aperture.config';

const HUB_NAME_BY_ID = new Map<number, string>(
  apertureConfig.ROUTE_HUBS.map((h) => [h.systemId, h.name]),
);

type SystemStatus = (typeof systemStatus.enumValues)[number];
type ConnectionScope = (typeof connectionScope.enumValues)[number];
type EolStage = (typeof eolStage.enumValues)[number];
type WhMass = (typeof whMass.enumValues)[number];
type WhJumpMass = (typeof whJumpMass.enumValues)[number];
type MapScope = (typeof mapScope.enumValues)[number];
type MapType = (typeof mapType.enumValues)[number];
type SignatureGroupKey = (typeof signatureGroupKey.enumValues)[number];
type TagScheme = (typeof tagScheme.enumValues)[number];
type NoteSeverity = (typeof mapNoteSeverity.enumValues)[number];

/** A visible system on a map, flattened with its `universe_system` metadata. */
export type MapSystemNode = {
  /** `ap_map_system.id`, as a string (xyflow node id). */
  id: string;
  /** EVE solar-system id (`universe_system.id`). */
  systemId: number;
  name: string;
  alias: string | null;
  tag: string | null;
  intelNotes: string | null;
  status: SystemStatus;
  security: string | null;
  trueSec: number | null;
  effect: string | null;
  regionName: string;
  constellationName: string;
  /** Target-class labels for each wormhole static (e.g. `["C3", "C5"]`); empty for k-space. */
  statics: string[];
  /** Nearest trade hub within high-sec range (precomputed at SDE ingest); null when none. */
  tradeHub: { name: string; jumps: number } | null;
  locked: boolean;
  /** ISO timestamp when the rally point was set; null when no rally is active. */
  rallyAt: string | null;
  positionX: number;
  positionY: number;
};

/** A connection between two systems on a map. Endpoints are `ap_map_system.id`s. */
export type MapConnectionEdge = {
  id: string;
  source: string;
  target: string;
  scope: ConnectionScope;
  massStatus: WhMass;
  jumpMassClass: WhJumpMass | null;
  /** EOL stage: `none` (not decaying), `eol` (~4h warning), `critical` (~1h final). */
  eolStage: EolStage;
  preserveMass: boolean;
  isRolling: boolean;
  /** User-designated as the source system's static (free manual flag). */
  isStatic: boolean;
  /** When the current `eol_stage` was entered (ISO). Null when `eolStage === 'none'`. */
  eolAt: string | null;
  /** ISO timestamp the row was inserted. Drives the pre-EOL "expires in X" hint. */
  createdAt: string;
};

/** A scan signature inside a placed system. Mirrors the realtime `signature.*` payload body. */
export type MapSignature = {
  /** `ap_map_signature.id` as a string. */
  id: string;
  /** `ap_map_system.id` the sig is in. */
  mapSystemId: string;
  /** `ap_map_connection.id` once the sig resolves to a wormhole, else null. */
  mapConnectionId: string | null;
  /** In-game 3-char scan id, e.g. "ABC". */
  sigId: string;
  /** Scanner-level group; null for "unknown". */
  groupKey: SignatureGroupKey | null;
  /** `universe_type.id`. Only meaningful when `groupKey === 'wormhole'` (points to a `universe_wormhole` row); otherwise null. */
  typeId: number | null;
  /** Display-only wormhole code (e.g. "B274"), resolved server-side from `universe_wormhole.name`. Null when `typeId` is null or not a wormhole. */
  wormholeCode: string | null;
  /** For wormhole sigs: redundant mirror of `wormholeCode`. For cosmic sigs: the user-typed EVE site name string (e.g. "Forgotten Perimeter Habitation Coils"). Null when unknown. */
  name: string | null;
  /** Freeform user notes. */
  description: string | null;
  /** ISO timestamp; `Date` serialised over the Server→Client boundary. */
  expiresAt: string;
  /** ISO timestamp the row was inserted. */
  createdAt: string;
  /** ISO timestamp of the last field change. */
  updatedAt: string;
};

/**
 * A free-standing note placed on a map (`ap_map_note`). Mirrors the realtime
 * `note.*` payload body. Attribution is denormalized: the creator/last-editor
 * character ids ride with their resolved names (LEFT JOIN `ap_character` twice),
 * so the inspector renders "created by X · last edited by Y" without a lookup.
 */
export type MapNote = {
  /** `ap_map_note.id` as a string (xyflow node id). */
  id: string;
  title: string;
  content: string | null;
  severity: NoteSeverity;
  locked: boolean;
  positionX: number;
  positionY: number;
  /** EVE character id of the creator; null if the character was erased. */
  createdByCharacterId: number | null;
  /** Resolved creator name; null when the id is null or the row is gone. */
  createdByName: string | null;
  lastEditedByCharacterId: number | null;
  lastEditedByName: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp of the last field change. */
  updatedAt: string;
};

/**
 * Initial roster of online tracked pilots currently in known systems. The
 * client `MapPresenceContext` seeds from this and then merges incoming
 * `characterUpdate` envelopes on top. Mirrors the envelope's resolved fields
 * (characterName + shipTypeName) so the canvas hover panel renders without a
 * follow-up SDE lookup.
 */
export type MapPresenceEntry = {
  characterId: number;
  characterName: string;
  /** Account id (`ap_user.id`); the grouping key for "group alts under main". */
  userId: number;
  /** The account's main character (`ap_user.main_character_id`); null if unset. */
  mainCharacterId: number | null;
  /** The main's name, for labeling a group whose main is offline; null if no main is set. */
  mainCharacterName: string | null;
  /** EVE solar-system id (`universe_system.id`). */
  systemId: number;
  /** Resolved `universe_system.name`; null if the id is unknown to the SDE. */
  systemName: string | null;
  /** `universe_system.security` class label (e.g. `C3`); null for k-space. */
  systemSecurity: string | null;
  /** `universe_system.true_sec`; null when unknown. Fallback class label for k-space. */
  systemTrueSec: number | null;
  shipTypeId: number | null;
  shipTypeName: string | null;
  /** Pilot's custom hull name (`ap_character.last_ship_name`); null before the first online tick. */
  shipName: string | null;
  /** ISO timestamp; non-null because the loader filters to characters that have completed at least one online tick. */
  locationAt: string;
};

/** Everything the read-only map page needs to render one map. */
export type MapViewData = {
  map: {
    id: string;
    name: string;
    scope: MapScope;
    type: MapType;
    /** Auto-tagging scheme; drives the Tags panel. Config is load-time (not realtime). */
    tagScheme: TagScheme;
    /** `ap_map_system.id` of the designated Home (the 0121 root), or null. */
    homeMapSystemId: string | null;
  };
  systems: MapSystemNode[];
  connections: MapConnectionEdge[];
  signatures: MapSignature[];
  notes: MapNote[];
  /** Tracked characters online + located on this map at load time. Realtime updates fold on top of this on the client. */
  presence: MapPresenceEntry[];
};

/** A map row for the maps list. */
export type MapListItem = {
  id: string;
  name: string;
  scope: MapScope;
  type: MapType;
  icon: string | null;
};

/** Editable map metadata + behaviour toggles, for the settings dialog. */
export type MapSettings = {
  name: string;
  icon: string | null;
  /** Immutable post-create; shown read-only in the dialog. */
  scope: MapScope;
  /** Immutable post-create; shown read-only in the dialog. */
  type: MapType;
  deleteExpiredConnections: boolean;
  deleteEolConnections: boolean;
  trackAbyssalJumps: boolean;
  logActivity: boolean;
  /** Auto-tagging scheme (owner/admin-gated). */
  tagScheme: TagScheme;
  /** `ap_map_system.id` of the designated Home, or null. */
  homeMapSystemId: string | null;
  /** ABC-only: leave the Home system's static target untagged. */
  exemptHomeStaticFromTag: boolean;
};

/**
 * A map row for the admin panel list. Carries the soft-delete state and the
 * full owner FKs so the admin UI can render ownership and offer
 * restore / purge-now actions. Separate from `MapListItem` because the regular
 * maps list deliberately hides ownership detail.
 */
export type AdminMapListItem = {
  id: string;
  name: string;
  scope: MapScope;
  type: MapType;
  icon: string | null;
  ownerCharacterId: string | null;
  ownerCorporationId: string | null;
  ownerAllianceId: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  /** ISO timestamp when soft-deleted; null when the map is active. */
  deletedAt: string | null;
};

/**
 * Load one map for the read-only view. Returns `null` when the map does not
 * exist, is soft-deleted, or the viewer is not allowed to see it
 * (`canViewMap`). The viewer-id parameter is required — passing the wrong id
 * is an access-control bug that the type system should catch.
 */
export async function loadMapForView(
  mapId: bigint,
  viewerCharacterId: bigint,
): Promise<MapViewData | null> {
  if (!(await canViewMap(viewerCharacterId, mapId))) return null;

  const [map] = await db
    .select({
      id: apMap.id,
      name: apMap.name,
      scope: apMap.scope,
      type: apMap.type,
      tagScheme: apMap.tagScheme,
      homeMapSystemId: apMap.homeMapSystemId,
    })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  if (!map) return null;

  const systemRows = await db
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
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.visible, true)))
    .orderBy(apMapSystem.id);

  const staticsBySystem = await loadStatics(systemRows.map((s) => s.systemId));

  const visibleSystemIds = systemRows.map((s) => s.id);

  // Only connections whose *both* endpoints are currently visible. Removing a
  // system flips `visible = false` but leaves its connection rows intact (intel
  // survives), so without this filter those orphan edges leak into the view —
  // harmlessly dropped by xyflow on the canvas, but rendered as "Unknown" rows
  // by consumers that iterate connections directly (e.g. SystemOverlay).
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
            // Dormant `wh` connections (endpoint removed, sig not re-pasted) carry
            // a NULL `confirmed_at` and must not resurface on reload. Non-`wh` rows
            // are always confirmed, so this never hides structural links.
            isNotNull(apMapConnection.confirmedAt),
          ),
        )
        .orderBy(apMapConnection.id)
    : [];
  const signatures = await loadSignaturesForSystems(visibleSystemIds);

  // Notes are independent of systems (no `visible` join) — load every note on the
  // map, resolving creator + last-editor names via two LEFT JOINs on ap_character.
  const noteCreator = alias(apCharacter, 'note_creator');
  const noteEditor = alias(apCharacter, 'note_editor');
  const noteRows = await db
    .select({
      id: apMapNote.id,
      title: apMapNote.title,
      content: apMapNote.content,
      severity: apMapNote.severity,
      locked: apMapNote.locked,
      positionX: apMapNote.positionX,
      positionY: apMapNote.positionY,
      createdByCharacterId: apMapNote.createdByCharacterId,
      createdByName: noteCreator.name,
      lastEditedByCharacterId: apMapNote.lastEditedByCharacterId,
      lastEditedByName: noteEditor.name,
      createdAt: apMapNote.createdAt,
      updatedAt: apMapNote.updatedAt,
    })
    .from(apMapNote)
    .leftJoin(noteCreator, eq(noteCreator.id, apMapNote.createdByCharacterId))
    .leftJoin(noteEditor, eq(noteEditor.id, apMapNote.lastEditedByCharacterId))
    .where(eq(apMapNote.mapId, mapId))
    .orderBy(apMapNote.id);

  const presence = await loadMapPresence(mapId);

  return {
    map: {
      id: map.id.toString(),
      name: map.name,
      scope: map.scope,
      type: map.type,
      tagScheme: map.tagScheme,
      homeMapSystemId: map.homeMapSystemId === null ? null : map.homeMapSystemId.toString(),
    },
    systems: systemRows.map((s) => ({
      id: s.id.toString(),
      systemId: s.systemId,
      name: s.name,
      alias: s.alias,
      tag: s.tag,
      intelNotes: s.intelNotes,
      status: s.status,
      security: s.security,
      trueSec: s.trueSec,
      effect: s.effect,
      regionName: s.regionName,
      constellationName: s.constellationName,
      statics: staticsBySystem.get(s.systemId) ?? [],
      tradeHub:
        s.nearestTradeHubId != null && s.nearestTradeHubJumps != null
          ? {
              name: HUB_NAME_BY_ID.get(s.nearestTradeHubId) ?? 'trade hub',
              jumps: s.nearestTradeHubJumps,
            }
          : null,
      locked: s.locked,
      rallyAt: s.rallyAt ? s.rallyAt.toISOString() : null,
      positionX: s.positionX,
      positionY: s.positionY,
    })),
    connections: connectionRows.map((c) => ({
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
    })),
    signatures,
    notes: noteRows.map((n) => ({
      id: n.id.toString(),
      title: n.title,
      content: n.content,
      severity: n.severity,
      locked: n.locked,
      positionX: n.positionX,
      positionY: n.positionY,
      createdByCharacterId: n.createdByCharacterId === null ? null : Number(n.createdByCharacterId),
      createdByName: n.createdByName,
      lastEditedByCharacterId:
        n.lastEditedByCharacterId === null ? null : Number(n.lastEditedByCharacterId),
      lastEditedByName: n.lastEditedByName,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
    presence,
  };
}

/**
 * Load a map's editable settings (name / icon / scope / type + behaviour
 * toggles) for the settings dialog. Gated by `canViewMap` to mirror
 * `loadMapForView`; returns null when the map is missing, soft-deleted, or the
 * viewer can't see it. The dialog's Save still re-checks `map_update`
 * server-side — this read only pre-fills the form.
 */
export async function loadMapSettings(
  viewerCharacterId: bigint,
  mapId: bigint,
): Promise<MapSettings | null> {
  if (!(await canViewMap(viewerCharacterId, mapId))) return null;

  const [row] = await db
    .select({
      name: apMap.name,
      icon: apMap.icon,
      scope: apMap.scope,
      type: apMap.type,
      deleteExpiredConnections: apMap.deleteExpiredConnections,
      deleteEolConnections: apMap.deleteEolConnections,
      trackAbyssalJumps: apMap.trackAbyssalJumps,
      logActivity: apMap.logActivity,
      tagScheme: apMap.tagScheme,
      homeMapSystemId: apMap.homeMapSystemId,
      exemptHomeStaticFromTag: apMap.exemptHomeStaticFromTag,
    })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)));
  if (!row) return null;
  return {
    ...row,
    homeMapSystemId: row.homeMapSystemId === null ? null : row.homeMapSystemId.toString(),
  };
}

/**
 * Online tracked pilots on this map, wherever they currently are. Joins
 * `ap_map_character_tracking` × `ap_character`, left-joins `universe_type` for
 * the ship name and `universe_system` for the location name + class (the pilot's
 * system need not be placed on the map). Filters to
 * `last_online = true AND last_system_id IS NOT NULL` — offline pilots are hidden
 * per the presence-badge UX (see SystemNode).
 */
export async function loadMapPresence(mapId: bigint): Promise<MapPresenceEntry[]> {
  // Self-join on ap_character to resolve the account's main character name from
  // ap_user.main_character_id (so the roster can label an alt's owner).
  const mainCharacter = alias(apCharacter, 'main_character');
  const rows = await db
    .select({
      characterId: apCharacter.id,
      characterName: apCharacter.name,
      userId: apCharacter.userId,
      mainCharacterId: apUser.mainCharacterId,
      mainCharacterName: mainCharacter.name,
      systemId: apCharacter.lastSystemId,
      systemName: universeSystem.name,
      systemSecurity: universeSystem.security,
      systemTrueSec: universeSystem.trueSec,
      shipTypeId: apCharacter.lastShipTypeId,
      shipTypeName: universeType.name,
      shipName: apCharacter.lastShipName,
      locationAt: apCharacter.lastLocationAt,
    })
    .from(apMapCharacterTracking)
    .innerJoin(apCharacter, eq(apCharacter.id, apMapCharacterTracking.characterId))
    .innerJoin(apUser, eq(apUser.id, apCharacter.userId))
    .leftJoin(mainCharacter, eq(mainCharacter.id, apUser.mainCharacterId))
    .leftJoin(universeType, eq(universeType.id, apCharacter.lastShipTypeId))
    .leftJoin(universeSystem, eq(universeSystem.id, apCharacter.lastSystemId))
    .where(
      and(
        eq(apMapCharacterTracking.mapId, mapId),
        // Defense-in-depth: a kicked/banned pilot with a lingering tracking row
        // must never render. View-access revocation (corp/alliance departure) is
        // handled by pruning the tracking row + `characterLogout`; this guards
        // the status axis the prune doesn't cover.
        eq(apCharacter.status, 'active'),
        eq(apCharacter.lastOnline, true),
        isNotNull(apCharacter.lastSystemId),
      ),
    )
    .orderBy(asc(apCharacter.name));

  return rows.flatMap((r) => {
    // `systemId` is non-null by the WHERE clause but Drizzle's column type stays
    // nullable; the locationAt invariant follows from `lastOnline = true`
    // because the online branch of the poll stamps both atomically.
    if (r.systemId === null || r.locationAt === null) return [];
    return [{
      characterId: Number(r.characterId),
      characterName: r.characterName,
      userId: r.userId,
      mainCharacterId: r.mainCharacterId === null ? null : Number(r.mainCharacterId),
      mainCharacterName: r.mainCharacterName,
      systemId: r.systemId,
      systemName: r.systemName,
      systemSecurity: r.systemSecurity,
      systemTrueSec: r.systemTrueSec,
      shipTypeId: r.shipTypeId,
      shipTypeName: r.shipTypeName,
      shipName: r.shipName,
      locationAt: r.locationAt.toISOString(),
    }];
  });
}

/**
 * Maps the viewer is allowed to see, ordered by name. Feeds the maps list.
 * Filtered server-side by `viewableMapPredicate` — admins see every
 * non-soft-deleted map; members see maps where they are the owner (by scope)
 * or where any of their roles appear in `ap_map_role_access`.
 */
export async function listViewableMaps(
  viewerCharacterId: bigint,
): Promise<MapListItem[]> {
  const viewPredicate = await viewableMapPredicate(viewerCharacterId);
  const where = viewPredicate
    ? and(isNull(apMap.deletedAt), viewPredicate)
    : isNull(apMap.deletedAt);

  const rows = await db
    .select({
      id: apMap.id,
      name: apMap.name,
      scope: apMap.scope,
      type: apMap.type,
      icon: apMap.icon,
    })
    .from(apMap)
    .where(where)
    .orderBy(apMap.name);
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}

/**
 * Every `ap_map` the operator console can act on, including soft-deleted rows.
 * `/admin` is global-admin-only, so this is unscoped. Distinct from
 * `listViewableMaps`, which applies the per-character view rule and filters out
 * `deleted_at IS NOT NULL`.
 *
 * Ordering: soft-deleted rows first (so the admin sees in-grace maps near the
 * top of the list), then by name.
 */
export async function listAdminMaps(): Promise<AdminMapListItem[]> {
  const rows = await db
    .select({
      id: apMap.id,
      name: apMap.name,
      scope: apMap.scope,
      type: apMap.type,
      icon: apMap.icon,
      ownerCharacterId: apMap.ownerCharacterId,
      ownerCorporationId: apMap.ownerCorporationId,
      ownerAllianceId: apMap.ownerAllianceId,
      createdAt: apMap.createdAt,
      updatedAt: apMap.updatedAt,
      deletedAt: apMap.deletedAt,
    })
    .from(apMap)
    .orderBy(sql`${apMap.deletedAt} DESC NULLS LAST`, apMap.name);

  return rows.map((r) => ({
    id: r.id.toString(),
    name: r.name,
    scope: r.scope,
    type: r.type,
    icon: r.icon,
    ownerCharacterId: r.ownerCharacterId === null ? null : r.ownerCharacterId.toString(),
    ownerCorporationId: r.ownerCorporationId === null ? null : r.ownerCorporationId.toString(),
    ownerAllianceId: r.ownerAllianceId === null ? null : r.ownerAllianceId.toString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt === null ? null : r.deletedAt.toISOString(),
  }));
}

async function loadStatics(systemIds: number[]): Promise<Map<number, string[]>> {
  const grouped = new Map<number, string[]>();
  if (systemIds.length === 0) return grouped;
  const rows = await db
    .select({
      systemId: universeSystemStatic.systemId,
      name: universeWormhole.name,
      targetClass: universeWormhole.targetClass,
    })
    .from(universeSystemStatic)
    .innerJoin(universeWormhole, eq(universeSystemStatic.typeId, universeWormhole.typeId))
    .where(inArray(universeSystemStatic.systemId, systemIds));
  for (const r of rows) {
    const code = r.targetClass ?? r.name;
    if (!code) continue; // K162-style rows can have no resolvable far-side class.
    const list = grouped.get(r.systemId);
    if (list) list.push(code);
    else grouped.set(r.systemId, [code]);
  }
  return grouped;
}
