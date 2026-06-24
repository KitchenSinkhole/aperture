import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
// Type-only (erased at compile) — `Layout` is RGL's `readonly LayoutItem[]`. Safe to
// pull into this server-imported barrel; no runtime client/server coupling.
import type { Layout } from 'react-grid-layout';
import type {
  apAccessGrant,
  apCharacter,
  apCharacterRole,
  apAlliance,
  apCorporation,
  apEventKind,
  apInstance,
  apInstanceOwner,
  apMap,
  apMapConnection,
  apMapConnectionLog,
  apMapEvent,
  apMapNote,
  apMapRoleAccess,
  apMapSignature,
  apMapSystem,
  apMapTrackingSeed,
  apRole,
  apRouteDestination,
  apStructure,
  apStructureEvent,
  apSystemStats,
  apUser,
  universeCategory,
  universeConstellation,
  universeDogmaAttribute,
  universeGroup,
  universeRegion,
  universeStargateEdge,
  universeSystem,
  universeSystemStatic,
  universeSovereigntyMap,
  universeFactionWarSystem,
  universeType,
  universeTypeAttribute,
  universeTypeOverride,
  universeWormhole,
} from '@/db/schema';
import type {
  accessCapability,
  accessMode,
  accessPrincipal,
  accessScope,
  authzLevel,
  mapRight,
  mapType,
  roleSource,
  routeSafety,
  signatureGroupKey,
  structureEventKind,
  tagScheme,
  whJumpMass,
} from '@/db/schema/ap/enums';

export type UniverseRegion = InferSelectModel<typeof universeRegion>;
export type NewUniverseRegion = InferInsertModel<typeof universeRegion>;

export type UniverseConstellation = InferSelectModel<typeof universeConstellation>;
export type NewUniverseConstellation = InferInsertModel<typeof universeConstellation>;

export type UniverseSystem = InferSelectModel<typeof universeSystem>;
export type NewUniverseSystem = InferInsertModel<typeof universeSystem>;

export type UniverseStargateEdge = InferSelectModel<typeof universeStargateEdge>;
export type NewUniverseStargateEdge = InferInsertModel<typeof universeStargateEdge>;

export type UniverseCategory = InferSelectModel<typeof universeCategory>;
export type NewUniverseCategory = InferInsertModel<typeof universeCategory>;

export type UniverseGroup = InferSelectModel<typeof universeGroup>;
export type NewUniverseGroup = InferInsertModel<typeof universeGroup>;

export type UniverseType = InferSelectModel<typeof universeType>;
export type NewUniverseType = InferInsertModel<typeof universeType>;

export type UniverseDogmaAttribute = InferSelectModel<typeof universeDogmaAttribute>;
export type NewUniverseDogmaAttribute = InferInsertModel<typeof universeDogmaAttribute>;

export type UniverseTypeAttribute = InferSelectModel<typeof universeTypeAttribute>;
export type NewUniverseTypeAttribute = InferInsertModel<typeof universeTypeAttribute>;

export type UniverseTypeOverride = InferSelectModel<typeof universeTypeOverride>;
export type NewUniverseTypeOverride = InferInsertModel<typeof universeTypeOverride>;

export type UniverseSystemStatic = InferSelectModel<typeof universeSystemStatic>;
export type NewUniverseSystemStatic = InferInsertModel<typeof universeSystemStatic>;

export type UniverseSovereigntyMap = InferSelectModel<typeof universeSovereigntyMap>;
export type NewUniverseSovereigntyMap = InferInsertModel<typeof universeSovereigntyMap>;

export type UniverseFactionWarSystem = InferSelectModel<typeof universeFactionWarSystem>;
export type NewUniverseFactionWarSystem = InferInsertModel<typeof universeFactionWarSystem>;

export type UniverseWormhole = InferSelectModel<typeof universeWormhole>;
export type NewUniverseWormhole = InferInsertModel<typeof universeWormhole>;

export type ApUser = InferSelectModel<typeof apUser>;
export type NewApUser = InferInsertModel<typeof apUser>;

export type ApRouteDestination = InferSelectModel<typeof apRouteDestination>;
export type NewApRouteDestination = InferInsertModel<typeof apRouteDestination>;

export type ApCharacter = InferSelectModel<typeof apCharacter>;
export type NewApCharacter = InferInsertModel<typeof apCharacter>;

export type ApMap = InferSelectModel<typeof apMap>;
export type NewApMap = InferInsertModel<typeof apMap>;

export type ApMapSystem = InferSelectModel<typeof apMapSystem>;
export type NewApMapSystem = InferInsertModel<typeof apMapSystem>;

export type ApMapNote = InferSelectModel<typeof apMapNote>;
export type NewApMapNote = InferInsertModel<typeof apMapNote>;

export type ApMapConnection = InferSelectModel<typeof apMapConnection>;
export type NewApMapConnection = InferInsertModel<typeof apMapConnection>;

export type ApMapConnectionLog = InferSelectModel<typeof apMapConnectionLog>;
export type NewApMapConnectionLog = InferInsertModel<typeof apMapConnectionLog>;

/**
 * Display row for the connection mass-log. One per logged jump,
 * joined to the acting character + ship type, with a running cumulative mass.
 * `mass`/`cumulativeMass` cross the wire as `number` (kg fits in a JS safe int).
 */
export type ConnectionMassLogEntry = {
  id: string;
  characterId: string | null;
  characterName: string | null;
  shipTypeId: number | null;
  shipTypeName: string | null;
  mass: number;
  cumulativeMass: number;
  jumpedAt: string;
};

export type ApMapSignature = InferSelectModel<typeof apMapSignature>;
export type NewApMapSignature = InferInsertModel<typeof apMapSignature>;

export type ApMapEvent = InferSelectModel<typeof apMapEvent>;
export type NewApMapEvent = InferInsertModel<typeof apMapEvent>;

export type ApMapTrackingSeed = InferSelectModel<typeof apMapTrackingSeed>;
export type NewApMapTrackingSeed = InferInsertModel<typeof apMapTrackingSeed>;

export type ApEventKind = InferSelectModel<typeof apEventKind>;
export type NewApEventKind = InferInsertModel<typeof apEventKind>;

export type ApSystemStats = InferSelectModel<typeof apSystemStats>;
export type NewApSystemStats = InferInsertModel<typeof apSystemStats>;

export type ApCorporation = InferSelectModel<typeof apCorporation>;
export type NewApCorporation = InferInsertModel<typeof apCorporation>;

export type ApAlliance = InferSelectModel<typeof apAlliance>;
export type NewApAlliance = InferInsertModel<typeof apAlliance>;

export type ApRole = InferSelectModel<typeof apRole>;
export type NewApRole = InferInsertModel<typeof apRole>;

export type ApCharacterRole = InferSelectModel<typeof apCharacterRole>;
export type NewApCharacterRole = InferInsertModel<typeof apCharacterRole>;

export type ApMapRoleAccess = InferSelectModel<typeof apMapRoleAccess>;
export type NewApMapRoleAccess = InferInsertModel<typeof apMapRoleAccess>;

export type ApInstance = InferSelectModel<typeof apInstance>;
export type NewApInstance = InferInsertModel<typeof apInstance>;

export type ApInstanceOwner = InferSelectModel<typeof apInstanceOwner>;
export type NewApInstanceOwner = InferInsertModel<typeof apInstanceOwner>;

export type ApAccessGrant = InferSelectModel<typeof apAccessGrant>;
export type NewApAccessGrant = InferInsertModel<typeof apAccessGrant>;

export type ApStructure = InferSelectModel<typeof apStructure>;
export type NewApStructure = InferInsertModel<typeof apStructure>;

export type ApStructureEvent = InferSelectModel<typeof apStructureEvent>;
export type NewApStructureEvent = InferInsertModel<typeof apStructureEvent>;

// Enum unions. `pgEnum` exposes its values via `.enumValues`; the
// `[number]` index extracts the union of string literals.
export type AuthzLevel = (typeof authzLevel.enumValues)[number];
export type MapRight = (typeof mapRight.enumValues)[number];
export type MapType = (typeof mapType.enumValues)[number];
export type RoleSource = (typeof roleSource.enumValues)[number];
export type RouteSafety = (typeof routeSafety.enumValues)[number];
export type SignatureGroupKey = (typeof signatureGroupKey.enumValues)[number];
export type StructureEventKind = (typeof structureEventKind.enumValues)[number];
export type TagScheme = (typeof tagScheme.enumValues)[number];
export type WhJumpMass = (typeof whJumpMass.enumValues)[number];

// Permissions-overhaul enum unions.
export type AccessMode = (typeof accessMode.enumValues)[number];
export type AccessPrincipal = (typeof accessPrincipal.enumValues)[number];
export type AccessScope = (typeof accessScope.enumValues)[number];
export type AccessCapability = (typeof accessCapability.enumValues)[number];
/** The six cosmic-signature groups (every group except `wormhole`). Their site
 * names are baked into the EVE client and have no SDE rows, so they're carried
 * as free-text `name` strings rather than a `typeId` FK. */
export type CosmicSignatureGroupKey = Exclude<SignatureGroupKey, 'wormhole'>;

/**
 * Per-account, already-resolved settings for the stale/unscanned signature map
 * indicators. `thresholdMinutes` is the *effective* value (the user override
 * already capped to the global default); the two booleans gate each indicator.
 * Resolved server-side by `getSignatureIndicatorPrefs` and consumed on the
 * client by `MapSignatureIndicatorContext`.
 */
export type SignatureIndicatorPrefs = {
  thresholdMinutes: number;
  showStale: boolean;
  showUnscanned: boolean;
};

/**
 * Raw (un-resolved) signature-indicator settings for the Account Settings dialog:
 * the global cap, the account's own override (`null` ⇒ use the global), and the
 * two toggles. Shaped by `getSignatureIndicatorAccountSettings` (`session.ts`).
 */
export type SignatureIndicatorAccountSettings = {
  globalThresholdMinutes: number;
  userThresholdMinutes: number | null;
  showStale: boolean;
  showUnscanned: boolean;
};

// routes-module. Configurable multi-hop route planner: shortest path from a
// picked character's current system to saved destinations, over K-space
// stargates + the live wormhole chain (+ optional EVE-Scout). Computed by
// `src/lib/map/routePlanner.ts`, rendered by `RoutePlannerModule`.

/**
 * Per-account route-planner settings (resolved from `ap_user`). `minShipClass`
 * is the smallest hull that must fit every wormhole on the route (`null` ⇒ no
 * minimum); the three `avoid*` flags drop reduced/critical-mass and EOL holes;
 * `includeEveScout` folds the public Thera/Turnur network into the graph.
 */
export type RoutePrefs = {
  safety: RouteSafety;
  minShipClass: WhJumpMass | null;
  avoidReduced: boolean;
  avoidCritical: boolean;
  avoidEol: boolean;
  includeEveScout: boolean;
};

/**
 * One system on a computed route. `via` is how this hop was *entered* from the
 * previous one (`origin` for the starting system); `connectionId` is the
 * `ap_map_connection.id` for a mapped wormhole/jumpbridge hop (null for gate /
 * eve_scout / origin); `onMap` marks systems present on the current map; `tag`
 * is the map's per-system label (`ap_map_system.tag`), null when off-map/untagged.
 */
export type RouteHop = {
  systemId: number;
  name: string;
  security: string | null;
  via: 'origin' | 'gate' | 'wh' | 'jumpbridge' | 'eve_scout';
  connectionId: number | null;
  onMap: boolean;
  tag: string | null;
};

/** A computed route from the origin to one destination. `jumps = hops.length - 1`. */
export type RoutePlan = {
  destinationSystemId: number;
  destinationName: string;
  reachable: boolean;
  jumps: number;
  hops: RouteHop[];
};

/** A saved destination joined to its solar-system display fields, for the panel. */
export type RouteDestinationView = {
  id: number;
  systemId: number;
  name: string;
  security: string | null;
  label: string | null;
};

// Read-only map view-model types (shaped in src/lib/map/loadMap.ts).
export type {
  MapSystemNode,
  MapConnectionEdge,
  MapSignature,
  MapNote,
  MapPresenceEntry,
  MapViewData,
  MapListItem,
  MapSettings,
  AdminMapListItem,
} from '@/lib/map/loadMap';

// Map import/export document + result types (src/lib/map/transfer.ts).
export type { MapExportFile, ImportSummary, ImportResult } from '@/lib/map/transfer';

// Thera module view-model + sync types (src/lib/map/thera.ts).
export type { TheraHub, TheraConnection, TheraSyncInput, TheraSyncResult } from '@/lib/map/thera';

// Auto-tagging strategy contract + view-model (src/lib/tagging/types.ts).
export type {
  ActiveScheme,
  TagSystem,
  TagEdge,
  TagContext,
  TagStrategy,
  AvailableTags,
} from '@/lib/tagging/types';

// Route module view-model (computed in src/lib/map/route.ts).
export type { HubRoute } from '@/lib/map/route';

// Read-side intel module view-models (computed in src/lib/map/intel.ts).
export type {
  SovereigntyIntel,
  FactionWarIntel,
  SystemExternalLinks,
  SystemIntelSummary,
} from '@/lib/map/intel';

// Third-party read-side integration summaries.
export type { RecentKillSummary } from '@/lib/integrations/zkb';
export type { EveScoutConnectionSummary } from '@/lib/integrations/evescout';
export type { ChangelogRelease } from '@/lib/integrations/github';

// Realtime WebSocket wire contracts (schemas in src/lib/realtime/protocol.ts).
export type {
  Envelope,
  ServerToClientTask,
  ClientToServerTask,
  ServerToClientMessage,
  ClientToServerMessage,
} from '@/lib/realtime/protocol';

// Realtime client connection status (provider in src/lib/realtime/useRealtime.tsx).
export type { RealtimeStatus } from '@/lib/realtime/useRealtime';

// Map-event payload contract (schemas in src/lib/realtime/protocol.ts).
export type { MapEventPayload, MapEventKind, MapEventPatch } from '@/lib/realtime/protocol';

// Map mutation core result type (src/lib/map/mutations/core.ts).
export type { ActionResult, CommitMapEventArgs } from '@/lib/map/mutations/core';

// System mutation input types (src/lib/map/mutations/systems.ts).
export type {
  AddSystemInput,
  AddSystemResult,
  RemoveSystemInput,
  UpdateSystemInput,
  UpdateSystemPatch,
} from '@/lib/map/mutations/systems';

// Connection mutation input types (src/lib/map/mutations/connections.ts).
export type {
  CreateConnectionInput,
  DeleteConnectionInput,
  UpdateConnectionInput,
  UpdateConnectionPatch,
} from '@/lib/map/mutations/connections';

// Signature mutation input types (src/lib/map/mutations/signatures.ts).
export type {
  CreateSignatureInput,
  UpdateSignatureInput,
  UpdateSignaturePatch,
  DeleteSignatureInput,
} from '@/lib/map/mutations/signatures';

// Bulk signature-paste orchestrator types (src/lib/map/mutations/bulkSignatures.ts).
export type {
  BulkPasteOptions,
  BulkPasteSummary,
  BulkPasteResult,
  PasteSignaturesInput,
} from '@/lib/map/mutations/bulkSignatures';

// Delete-subchain orchestrator types (src/lib/map/mutations/subchain.ts).
export type {
  DeleteSubchainInput,
  SubchainDeleteSummary,
  SubchainDeleteResult,
} from '@/lib/map/mutations/subchain';

// Restore-connection orchestrator types (src/lib/map/mutations/restoreConnection.ts).
export type {
  RestoreConnectionInput,
  RestoreConnectionResult,
} from '@/lib/map/mutations/restoreConnection';

// Wormhole-catalog lookup result types (src/lib/map/wormholeTypes.ts).
export type { WormholeTypeOption, StaticMatch } from '@/lib/map/wormholeTypes';

// Solar-system name search result (src/lib/map/systemSearch.ts).
export type { SystemSearchResult } from '@/lib/map/systemSearch';

// Read-side structure-intel view-models (computed in src/lib/structures/read.ts).
export type { StructureIntel, UpwellStructureType } from '@/lib/structures/read';

// Rolling 24h activity totals per system (computed in src/lib/map/stats.ts).
export type { SystemStatsSummary } from '@/lib/map/stats';

// Corporation name-search result for the structure owner picker (src/lib/structures/corpSearch.ts).
export type { CorpSearchResult } from '@/lib/structures/corpSearch';

// Structure mutation input types (src/lib/structures/mutations.ts).
export type {
  CreateStructureInput,
  UpdateStructureInput,
  UpdateStructurePatch,
  DeleteStructureInput,
} from '@/lib/structures/mutations';

// Shared JSON fetch result (src/lib/http/fetchJson.ts).
export type { FetchResult } from '@/lib/http/fetchJson';

// Structure client request-body shapes (src/lib/structures/client.ts).
export type { CreateStructureBody, UpdateStructureBody } from '@/lib/structures/client';

// Signature paste parser + resolver (src/lib/map/signatureParser.ts, signatureReader.ts).
export type { ParsedSigRow } from '@/lib/map/signatureParser';
export type { ResolvedSigRow } from '@/lib/map/signatureReader';

// Scanner-level signature group catalog (src/lib/map/signatureGroups.ts).
export type { SignatureGroupOption } from '@/lib/map/signatureGroups';

// Localized signature Class catalog (src/lib/map/signatureClasses.ts).
export type { SignatureClassKind, SignatureClassOption } from '@/lib/map/signatureClasses';

// ESI opKey identifiers (map in src/lib/esi/opkeys.ts).
export type { OpKey, OpDef } from '@/lib/esi/opkeys';

// Static reference data for the system-reference dialogs.
export type { SystemEffect, SystemEffectBonus, SystemEffectKey } from '@/lib/eve/systemEffects';
export type { WormholeJumpInfoRow } from '@/lib/eve/wormholeJumpInfo';

// Activity-statistics view-models (computed in src/lib/stats/activity.ts).
export type {
  ActivityStatScope,
  ActivityStatPeriod,
  ActivityTriplet,
  ActivityStatRow,
  ActivityStatsResponse,
} from '@/lib/stats/activity';

// Manager audit-console view-models + query contract (src/lib/map/audit.ts).
export type {
  AuditEventCategory,
  AuditEventRow,
  AuditActor,
  ActorSummary,
  AuditQueryParams,
  AuditPage,
} from '@/lib/map/audit';

// ESI client decoded-response types.
export type {
  EsiStatus,
  EsiLocation,
  EsiRoute,
  EsiSovereigntyMap,
  EsiFactionWarSystems,
} from '@/lib/esi/decoders';

/**
 * Visual configuration for a map-node "underglow" — a pulsing colored glow
 * rendered beneath a `SystemNode`. The component is intentionally
 * notification-agnostic; callers (`underglowPresets.ts`) pick the look per
 * notification kind (killmail = red, future rally/unscanned-sig presets, …).
 */
export type UnderglowConfig = {
  /** Any CSS color. */
  color: string;
  /** Peak glow intensity, 0..1. */
  brightness: number;
  /** Transient lifetime in ms; `0` ⇒ persistent until explicitly cleared. */
  durationMs: number;
  /** Duration of one pulse cycle in ms. */
  speedMs: number;
};

// Free-form map layout (map-layout-builder). The user's per-account global dashboard
// arrangement, persisted on `ap_user.map_layout` and applied to every map they open.
/** Every draggable card in the map dashboard grid. */
export type PanelId =
  | 'canvas'
  | 'signatures'
  | 'inspector'
  | 'route'
  | 'intel'
  | 'structure'
  | 'killStats'
  | 'systemGraph'
  | 'systemKillboard'
  | 'tags'
  | 'thera';

/** Responsive breakpoint keys. Each holds an independent arrangement. */
export type Breakpoint = 'lg' | 'md' | 'sm';

/**
 * The stored layout. `layouts[bp]` is react-grid-layout's `Layout` (a
 * `readonly LayoutItem[]` — `{ i, x, y, w, h, minW?, minH?, … }`); each item's `i` is a
 * `PanelId` (enforced at the Zod boundary, not the structural type). A `PanelId` present
 * in the registry but missing from a saved breakpoint is auto-placed on load, so new
 * panels need no data migration. `hidden` is the set the user removed from the grid.
 */
export interface MapLayoutConfig {
  version: number;
  layouts: Record<Breakpoint, Layout>;
  hidden: PanelId[];
}

/**
 * A right-click target on the map canvas, carrying both the kind/id of what was
 * clicked and the client (screen) coordinates of the cursor used to anchor the
 * context menu. `null` ⇒ no menu open. `system`/`connection`/`note` carry the row
 * id; `pane` is the empty-canvas background. Right-click does not change selection
 * — the menu operates on `id` directly.
 */
export type MapContextMenuTarget =
  | { kind: 'system'; id: string; x: number; y: number }
  | { kind: 'connection'; id: string; x: number; y: number }
  | { kind: 'note'; id: string; x: number; y: number }
  | { kind: 'pane'; x: number; y: number };

/** Filter state for `SignatureSearchDialog`. Owned by `MapCanvas` so it persists between opens. */
export type SigSearchFilters = {
  name: string;
  groupKey: SignatureGroupKey | null;
  maxAgeHours: number | null;
  /** `MapSystemNode.security` labels to include; empty = all. */
  securityClasses: string[];
};
