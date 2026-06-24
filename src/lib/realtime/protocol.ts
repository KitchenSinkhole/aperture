import { z } from 'zod';
import {
  connectionScope,
  eolStage,
  mapNoteSeverity,
  mapScope,
  mapType,
  signatureGroupKey,
  systemStatus,
  whJumpMass,
  whMass,
} from '@/db/schema/ap/enums';

/**
 * Wire contracts for the Aperture realtime WebSocket transport.
 *
 * Architecture (CLAUDE.md "Realtime"): the WebSocket is
 * broadcast-only. A map mutation lands as one `INSERT INTO ap_map_event`; an
 * AFTER INSERT trigger fires `pg_notify('map:'||map_id, …)`; the WS server's
 * Postgres LISTEN handler picks it up and fans the envelope to subscribed
 * sockets. Clients never mutate over the socket — the only client→server
 * messages are `subscribe` / `unsubscribe`.
 *
 * Authorization is session-based (Auth.js). `subscribe` only names the map
 * channels the client wants; the server independently checks the session has
 * access. There is no token handshake on the wire.
 *
 * Fidelity: the envelope and control-plane messages are pinned here. The
 * data-bearing bodies (mapUpdate/characterUpdate/etc.) are derived from
 * Aperture's operational need.
 */

// ---------------------------------------------------------------------------
// Task vocabulary (fixed — CLAUDE.md). Do not add task names without updating
// the spec.
// ---------------------------------------------------------------------------

export const SERVER_TO_CLIENT_TASKS = [
  'mapUpdate',
  'mapAccess',
  'mapConnectionAccess',
  'mapDeleted',
  'characterUpdate',
  'characterLogout',
  'healthCheck',
  'logData',
  'systemNotification',
  'connectionMassLog',
] as const;

export const CLIENT_TO_SERVER_TASKS = ['subscribe', 'unsubscribe'] as const;

export type ServerToClientTask = (typeof SERVER_TO_CLIENT_TASKS)[number];
export type ClientToServerTask = (typeof CLIENT_TO_SERVER_TASKS)[number];

// ---------------------------------------------------------------------------
// Envelope. Every frame is `{ task, load }` (CLAUDE.md wire frame). `load` is
// validated per-task by the discriminated unions below; the raw envelope keeps
// it `unknown` so a malformed frame fails at the task layer with context.
// ---------------------------------------------------------------------------

export const envelopeSchema = z.object({
  task: z.enum([...SERVER_TO_CLIENT_TASKS, ...CLIENT_TO_SERVER_TASKS]),
  load: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

// ---------------------------------------------------------------------------
// Control-plane load schemas (pinned firm).
// ---------------------------------------------------------------------------

/** Client → server. Names the map channels to (un)subscribe; access is checked server-side via the session. */
export const subscribeLoadSchema = z.object({
  mapIds: z.array(z.number().int().positive()),
});

export const unsubscribeLoadSchema = subscribeLoadSchema;

/** Liveness probe. Client sends `{ ts }`; server echoes it back with status. */
export const healthCheckLoadSchema = z.object({
  ts: z.number(),
  ok: z.boolean().optional(),
  listeners: z.number().int().nonnegative().optional(),
});

export const mapDeletedLoadSchema = z.object({
  mapId: z.number().int().positive(),
});

export const characterLogoutLoadSchema = z.object({
  characterIds: z.array(z.number().int().positive()),
});

export type CharacterLogoutLoad = z.infer<typeof characterLogoutLoadSchema>;

export const mapAccessLoadSchema = z.object({
  mapId: z.number().int().positive(),
  characterIds: z.array(z.number().int().positive()),
});

// ---------------------------------------------------------------------------
// Map-event payload contract. The jsonb `ap_map_event.payload` *is*
// this body: the `tg_map_event_notify` trigger forwards it verbatim and `bus.ts`
// re-wraps it as the `mapUpdate.load.data`. Convention: every payload is
// `{ kind, eventId, ...patch }` — `kind` selects the variant, `eventId` is the
// new `ap_map_event.id` for client-side dedupe, and the patch carries exactly
// what a canvas needs to apply the change without refetching. Timestamps cross
// the wire as ISO strings (jsonb-serialized `Date`s).
// ---------------------------------------------------------------------------

const systemStatusEnum = z.enum(systemStatus.enumValues);
const connectionScopeEnum = z.enum(connectionScope.enumValues);
const whMassEnum = z.enum(whMass.enumValues);
const whJumpMassEnum = z.enum(whJumpMass.enumValues);
const eolStageEnum = z.enum(eolStage.enumValues);
const mapScopeEnum = z.enum(mapScope.enumValues);
const mapTypeEnum = z.enum(mapType.enumValues);
const signatureGroupKeyEnum = z.enum(signatureGroupKey.enumValues);
const mapNoteSeverityEnum = z.enum(mapNoteSeverity.enumValues);

const eventId = z.number().int().positive();

/** Full node body — mirrors `MapSystemNode` (loadMap.ts) so a client can append. */
const systemNodeBody = {
  id: z.string(),
  systemId: z.number().int(),
  name: z.string(),
  alias: z.string().nullable(),
  tag: z.string().nullable(),
  intelNotes: z.string().nullable(),
  status: systemStatusEnum,
  security: z.string().nullable(),
  trueSec: z.number().nullable(),
  effect: z.string().nullable(),
  regionName: z.string(),
  constellationName: z.string(),
  statics: z.array(z.string()),
  tradeHub: z.object({ name: z.string(), jumps: z.number().int() }).nullable(),
  locked: z.boolean(),
  rallyAt: z.string().nullable(),
  positionX: z.number(),
  positionY: z.number(),
};

/** Full edge body — mirrors `MapConnectionEdge` (loadMap.ts). */
const connectionEdgeBody = {
  id: z.string(),
  source: z.string(),
  target: z.string(),
  scope: connectionScopeEnum,
  massStatus: whMassEnum,
  jumpMassClass: whJumpMassEnum.nullable(),
  eolStage: eolStageEnum,
  preserveMass: z.boolean(),
  isRolling: z.boolean(),
  isStatic: z.boolean(),
  eolAt: z.string().nullable(),
  createdAt: z.string(),
};

/** Full signature body — mirrors `ap_map_signature` row fields used by the canvas. */
const signatureBody = {
  id: z.string(),
  mapSystemId: z.string(),
  mapConnectionId: z.string().nullable(),
  sigId: z.string(),
  groupKey: signatureGroupKeyEnum.nullable(),
  typeId: z.number().int().nullable(),
  wormholeCode: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Audit descriptor: the far endpoint (`ap_map_system` id) of the linked
  // connection — what the sig "leads to". Null/absent when unlinked. The canvas
  // ignores it; the audit/Discord resolve it to a system name.
  leadsToMapSystemId: z.string().nullable().optional(),
};

/**
 * Full note body — mirrors `MapNote` (loadMap.ts) so a client can append a
 * freshly-created note straight from the realtime payload. Unlike the systems
 * pattern, attribution is denormalized: the creator/last-editor ids + resolved
 * names ride the body so the inspector can show "created by X · last edited by Y"
 * without a follow-up roster lookup. Character ids cross the wire as numbers (an
 * EVE character id fits in `Number.MAX_SAFE_INTEGER`, like `characterUpdate`).
 */
const noteBody = {
  id: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  severity: mapNoteSeverityEnum,
  locked: z.boolean(),
  positionX: z.number(),
  positionY: z.number(),
  createdByCharacterId: z.number().int().nullable(),
  createdByName: z.string().nullable(),
  lastEditedByCharacterId: z.number().int().nullable(),
  lastEditedByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const mapEventPayloadSchema = z.discriminatedUnion('kind', [
  // A pure node-body delta: "this system became visible." Its signatures are NOT
  // embedded — the canvas hydrates them via `GET …/systems/[id]/signatures` on
  // receipt, keeping the event small (the full-sig payload otherwise breached the
  // 8 KB `pg_notify` ceiling and rolled back the insert).
  z.object({
    kind: z.literal('system.added'),
    eventId,
    ...systemNodeBody,
  }),
  z.object({ kind: z.literal('system.removed'), eventId, id: z.string() }),
  z.object({
    kind: z.literal('system.updated'),
    eventId,
    id: z.string(),
    alias: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
    status: systemStatusEnum.optional(),
    intelNotes: z.string().nullable().optional(),
    locked: z.boolean().optional(),
    rallyAt: z.string().nullable().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
  }),
  z.object({ kind: z.literal('connection.create'), eventId, ...connectionEdgeBody }),
  z.object({
    kind: z.literal('connection.update'),
    eventId,
    id: z.string(),
    scope: connectionScopeEnum.optional(),
    massStatus: whMassEnum.optional(),
    jumpMassClass: whJumpMassEnum.nullable().optional(),
    eolStage: eolStageEnum.optional(),
    preserveMass: z.boolean().optional(),
    isRolling: z.boolean().optional(),
    isStatic: z.boolean().optional(),
    eolAt: z.string().nullable().optional(),
    // Audit descriptors (endpoint `ap_map_system` ids). Carried so the event
    // self-describes its endpoints even after the connection is hard-deleted —
    // the canvas ignores them. See the preamble's payload-philosophy note.
    source: z.string().optional(),
    target: z.string().optional(),
  }),
  // `source`/`target` are the endpoint `ap_map_system` ids, captured at delete
  // time because the connection row is hard-deleted (unrecoverable afterwards).
  z.object({
    kind: z.literal('connection.delete'),
    eventId,
    id: z.string(),
    source: z.string().optional(),
    target: z.string().optional(),
  }),
  z.object({ kind: z.literal('signature.create'), eventId, ...signatureBody }),
  z.object({
    kind: z.literal('signature.update'),
    eventId,
    id: z.string(),
    // Audit descriptor: the owning `ap_map_system` id, and `sigId` always carries
    // the resulting in-game code (even when the code itself wasn't the edited
    // field) so the event names *which* signature without an extra join. The
    // canvas re-applying the unchanged code is a no-op.
    mapSystemId: z.string().optional(),
    mapConnectionId: z.string().nullable().optional(),
    // Far endpoint of the connection being linked/unlinked (audit descriptor) —
    // resolves "leads to / unlinked from **X**". Present only when the link changes.
    leadsToMapSystemId: z.string().nullable().optional(),
    sigId: z.string().optional(),
    groupKey: signatureGroupKeyEnum.nullable().optional(),
    typeId: z.number().int().nullable().optional(),
    wormholeCode: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    expiresAt: z.string().optional(),
    updatedAt: z.string().optional(),
    // Full post-update row (Stage 2 self-heal). Additive to the conditional
    // audit fields above — the formatter/audit ignore it and keep reading those,
    // so precision + no-op suppression are untouched. The canvas upserts from it
    // to materialize a sig whose `signature.create` it never received (reconnect
    // gaps, reordering). Its `leadsToMapSystemId` is populated for linked sigs so
    // the Stage 4 restore offer can name a dormant connection's destination.
    snapshot: z.object(signatureBody).optional(),
  }),
  // `mapSystemId`/`sigId` captured at delete time (the signature row is
  // hard-deleted) so the audit names the system and the in-game code.
  z.object({
    kind: z.literal('signature.delete'),
    eventId,
    id: z.string(),
    mapSystemId: z.string().optional(),
    sigId: z.string().optional(),
  }),
  z.object({ kind: z.literal('note.created'), eventId, ...noteBody }),
  z.object({
    kind: z.literal('note.updated'),
    eventId,
    id: z.string(),
    // `title` always rides as the audit/Discord descriptor (names *which* note),
    // mirroring how `signature.update` always carries `sigId`. The canvas
    // re-applying an unchanged title is a no-op. The remaining fields are present
    // only when they actually changed (merge-by-id on the client).
    title: z.string(),
    content: z.string().nullable().optional(),
    severity: mapNoteSeverityEnum.optional(),
    locked: z.boolean().optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    // The editor identity always rides so the inspector's "last edited by" stays
    // live; `updatedAt` likewise.
    lastEditedByCharacterId: z.number().int().nullable(),
    lastEditedByName: z.string().nullable(),
    updatedAt: z.string(),
  }),
  // `title` captured at delete time (the note row is hard-deleted) so the audit
  // names the note even after the row is gone.
  z.object({ kind: z.literal('note.deleted'), eventId, id: z.string(), title: z.string() }),
  z.object({
    kind: z.literal('map.create'),
    eventId,
    id: z.string(),
    name: z.string(),
    scope: mapScopeEnum,
    type: mapTypeEnum,
    icon: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('map.update'),
    eventId,
    id: z.string(),
    name: z.string().optional(),
    icon: z.string().nullable().optional(),
    deleteExpiredConnections: z.boolean().optional(),
    deleteEolConnections: z.boolean().optional(),
    trackAbyssalJumps: z.boolean().optional(),
    logActivity: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('map.delete'),
    eventId,
    id: z.string(),
    deletedAt: z.string().nullable().optional(),
  }),
  // Admin clears `ap_map.deleted_at` (un-soft-deletes).
  z.object({ kind: z.literal('map.restore'), eventId, id: z.string() }),
  // Admin hard-deletes a soft-deleted map immediately (skips the
  // 30-day map-purge cron grace). Emitted inside the same transaction as the
  // row delete, BEFORE the DELETE; pg_notify buffers the notification until
  // COMMIT, so subscribers receive it even though the source event row is
  // cascaded out by the parent DELETE.
  z.object({ kind: z.literal('map.purge'), eventId, id: z.string() }),
]);

export type MapEventPayload = z.infer<typeof mapEventPayloadSchema>;

/**
 * Seeded `ap_event_kind` values (migrations 0004 + 0014). The discriminator set.
 * Includes `map.restore` and `map.purge` for the admin maps panel.
 */
export const MAP_EVENT_KINDS = [
  'system.added',
  'system.removed',
  'system.updated',
  'connection.create',
  'connection.update',
  'connection.delete',
  'signature.create',
  'signature.update',
  'signature.delete',
  'note.created',
  'note.updated',
  'note.deleted',
  'map.create',
  'map.update',
  'map.delete',
  'map.restore',
  'map.purge',
] as const;

export type MapEventKind = (typeof MAP_EVENT_KINDS)[number];

/** Patch fields for a given kind — the body `mutate()` returns, minus `kind`/`eventId`. */
export type MapEventPatch<K extends MapEventKind> = Omit<
  Extract<MapEventPayload, { kind: K }>,
  'kind' | 'eventId'
>;

// ---------------------------------------------------------------------------
// Data-bearing load schemas. `mapUpdate` carries the event payload above; the
// rest are forward-declared (tightened in later stages).
// ---------------------------------------------------------------------------

/** Fired after any map-affecting mutation (one per `ap_map_event` insert). */
export const mapUpdateLoadSchema = z.object({
  mapId: z.number().int().positive(),
  kind: z.string().optional(),
  data: mapEventPayloadSchema.optional(),
});

export const mapConnectionAccessLoadSchema = z.object({
  mapId: z.number().int().positive(),
  // per-connection access body.
  data: z.unknown().optional(),
});

/**
 * `characterUpdate` envelope load. Emitted by the location-poll on
 * every tick that changes the character's persisted state — broadcast on the
 * same `map:<id>` LISTEN channels as `mapUpdate` (one notification per tracked
 * map). The bus discriminates by the `task` discriminator in the pg_notify
 * payload (see `src/lib/realtime/bus.ts`).
 *
 * `systemId` and `shipTypeId` are nullable because the poll persists the last
 * known values; before the first successful online tick (or while offline)
 * either may be `null`. `online` is `null` between the very first enqueue and
 * the first completed tick.
 *
 * `characterName` rides every envelope so the client never needs a roster
 * lookup to render the breadcrumb. `userId`/`mainCharacterId`/`mainCharacterName`
 * carry the pilot's account + main identity so the roster can keep grouping alts
 * under their main across live moves (both main fields null when no main is set).
 * `shipTypeName` is the resolved `universe_type.name`
 * for `shipTypeId` — null when `shipTypeId` is null or the row is missing.
 * `shipName` is the pilot's custom hull name (ESI `getCharacterShip.ship_name`,
 * cached on `ap_character.last_ship_name`) — null before the first online tick.
 * `systemName`/`systemSecurity`/`systemTrueSec` are the resolved `universe_system`
 * fields for `systemId`, so the Map Info pilot roster can label a pilot's location
 * even when their system isn't placed on the map. Null when `systemId` is null or
 * unknown to the SDE. The envelope stays self-contained per the payload philosophy
 * (see the mapEventPayloadSchema preamble above) at the cost of two tiny SDE
 * lookups per poll tick.
 *
 * Numbers ride the wire (JSON has no `bigint`); the EVE character id and
 * solar-system id both fit comfortably in `number.MAX_SAFE_INTEGER`.
 */
export const characterUpdateLoadSchema = z.object({
  characterId: z.number().int().positive(),
  characterName: z.string(),
  userId: z.number().int().positive(),
  mainCharacterId: z.number().int().nullable(),
  mainCharacterName: z.string().nullable(),
  online: z.boolean().nullable(),
  systemId: z.number().int().nullable(),
  systemName: z.string().nullable(),
  systemSecurity: z.string().nullable(),
  systemTrueSec: z.number().nullable(),
  shipTypeId: z.number().int().nullable(),
  shipTypeName: z.string().nullable(),
  shipName: z.string().nullable(),
  locationAt: z.string().nullable(),
});

export type CharacterUpdateLoad = z.infer<typeof characterUpdateLoadSchema>;

/**
 * `systemNotification` envelope load. A *transient*
 * server-observed event about a solar system on a map — it carries no map state
 * and so, like `characterUpdate`, is broadcast by a direct `pg_notify` that
 * bypasses `ap_map_event` (see `src/lib/integrations/zkbFeed.ts`). The bus
 * discriminates on the top-level `task` field.
 *
 * `kind` selects the notification flavour; the client owns the visual treatment
 * (`underglowPresets.ts`) so the wire stays lean. `systemId` is the EVE
 * solar-system id; the client resolves it to the on-screen node.
 *
 * Two kinds today, discriminated by `kind`:
 * - `killmail` — server-observed (zKB feed), carries the kill detail.
 * - `ping` — user-initiated attention pulse. The client POSTs `/api/map/[mapId]/ping`
 *   (`src/lib/map/ping.ts`), which fans this out; it carries no extra body — the
 *   look is the client's `ping` underglow preset. The initiator receives its own
 *   ping echo (it's subscribed to the same channel), so every viewer pulses
 *   identically via `MapUnderglowBridge`.
 */
export const systemNotificationLoadSchema = z.discriminatedUnion('kind', [
  z.object({
    mapId: z.number().int().positive(),
    systemId: z.number().int(),
    kind: z.literal('killmail'),
    killmail: z.object({
      killmailId: z.number().int(),
      shipTypeId: z.number().int().nullable(),
      totalValue: z.number().nullable(),
      href: z.string(),
    }),
  }),
  z.object({
    mapId: z.number().int().positive(),
    systemId: z.number().int(),
    kind: z.literal('ping'),
  }),
]);

export type SystemNotificationLoad = z.infer<typeof systemNotificationLoadSchema>;

/**
 * `connectionMassLog` envelope load. A *transient*
 * server-observed event: the location-poll logged a ship's jump across a
 * wormhole connection. Like `characterUpdate` / `systemNotification` it carries
 * no `MapViewData` state and is broadcast by a direct `pg_notify` that bypasses
 * `ap_map_event` (see `src/lib/map/connectionMassLog.ts`). The bus discriminates
 * on the top-level `task` field.
 *
 * `connectionId` / `logId` cross the wire as strings (stringified bigints);
 * `mass` and `cumulativeMass` are kg as numbers (a hole's total stable mass is
 * well within `Number.MAX_SAFE_INTEGER`). The open inspector refetches the log
 * for the named connection on receipt.
 */
export const connectionMassLogLoadSchema = z.object({
  mapId: z.number().int().positive(),
  connectionId: z.string(),
  logId: z.string(),
  characterId: z.number().int().nullable(),
  shipTypeId: z.number().int().nullable(),
  mass: z.number(),
  cumulativeMass: z.number(),
  jumpedAt: z.string(),
});

export type ConnectionMassLogLoad = z.infer<typeof connectionMassLogLoadSchema>;

export const logDataLoadSchema = z.object({
  mapId: z.number().int().positive(),
  // the ap_map_event history record.
  data: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Messages (envelope + typed load), as discriminated unions on `task`.
// ---------------------------------------------------------------------------

function message<T extends string, L extends z.ZodTypeAny>(task: T, load: L) {
  return z.object({ task: z.literal(task), load });
}

export const serverToClientMessageSchema = z.discriminatedUnion('task', [
  message('mapUpdate', mapUpdateLoadSchema),
  message('mapAccess', mapAccessLoadSchema),
  message('mapConnectionAccess', mapConnectionAccessLoadSchema),
  message('mapDeleted', mapDeletedLoadSchema),
  message('characterUpdate', characterUpdateLoadSchema),
  message('characterLogout', characterLogoutLoadSchema),
  message('healthCheck', healthCheckLoadSchema),
  message('logData', logDataLoadSchema),
  message('systemNotification', systemNotificationLoadSchema),
  message('connectionMassLog', connectionMassLogLoadSchema),
]);

export const clientToServerMessageSchema = z.discriminatedUnion('task', [
  message('subscribe', subscribeLoadSchema),
  message('unsubscribe', unsubscribeLoadSchema),
]);

export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;
export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;
