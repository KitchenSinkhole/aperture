import 'server-only';
import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  apCharacter,
  apMapEvent,
  apMapSystem,
  apUser,
  universeSystem,
} from '@/db/schema';
import {
  mapEventPayloadSchema,
  type MapEventKind,
  type MapEventPayload,
} from '@/lib/realtime/protocol';
import { describeMapEvent, type WebhookEventContext } from '@/lib/webhooks/formatters';

/**
 * Read layer for the in-map audit console (`GET /api/map/[mapId]/audit`, gated
 * by `canManageMap`).
 *
 * Every map mutation already lands as one `ap_map_event` row; this module is the
 * only read path that turns that append-only log into a human-browsable feed.
 * It reuses `describeMapEvent` (the same renderer the Discord history webhook
 * uses) so a commit reads identically on both surfaces, and it resolves the
 * naming context for a whole *page* of events in a fixed number of queries
 * rather than the dispatcher's one-event-at-a-time joins.
 */

export type AuditEventCategory = 'system' | 'connection' | 'signature' | 'note' | 'map';

/** One rendered commit for the audit table. Ids cross the wire as strings (bigint). */
export interface AuditEventRow {
  id: string;
  occurredAt: string;
  kind: MapEventKind;
  category: AuditEventCategory;
  /** Acting character id; `null` for job-driven / automation events. */
  characterId: string | null;
  characterName: string | null;
  /** Sentence-cased action with no actor ("Set Jita status to `friendly`."). Never null. */
  summary: string;
  /** A destroy-shaped action (system/connection/signature removal, map delete/purge). */
  destructive: boolean;
}

/** A distinct actor on a map, for the filter dropdown. `characterId: null` = automation. */
export interface AuditActor {
  /** The acting account's main character id (commits roll up to the main). `null` = automation. */
  characterId: string | null;
  name: string;
  eventCount: number;
}

/** Per-actor aggregate for the drill-down header. */
export interface ActorSummary {
  total: number;
  destructive: number;
  byCategory: Record<AuditEventCategory, number>;
}

export interface AuditQueryParams {
  mapId: bigint;
  /** A specific character, `'none'` for the automation bucket, or omit for all actors. */
  characterId?: bigint | 'none';
  kinds?: MapEventKind[];
  from?: Date;
  to?: Date;
  /** Best-effort substring search over actor name, kind, and a few payload fields. */
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AuditPage {
  rows: AuditEventRow[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const DESTRUCTIVE_KINDS: ReadonlySet<MapEventKind> = new Set([
  'system.removed',
  'connection.delete',
  'signature.delete',
  'note.deleted',
  'map.delete',
  'map.purge',
]);

/**
 * Drop position-only `system.updated` rows (pure canvas drags) at the DB so paging
 * stays dense — these are the rows `describeMapEvent` returns `null` for. A drag
 * patch carries `positionX` but none of the meaningful fields; uses the underlying
 * `jsonb_exists*` functions to avoid the `?`/`?|` operators (driver placeholder
 * ambiguity). Null payloads on non-`system.updated` rows are unaffected.
 */
const excludePositionOnly: SQL = sql`not (${apMapEvent.kind} = 'system.updated' and jsonb_exists(${apMapEvent.payload}, 'positionX') and not jsonb_exists_any(${apMapEvent.payload}, array['status','alias','tag','intelNotes','locked','rallyAt']))`;

// Same drag-noise drop for note position-only `note.updated` rows. `title` always
// rides a note update (the descriptor), so the meaningful-field set deliberately
// excludes it: a pure drag carries positionX and none of [content,severity,locked],
// while a title rename carries no positionX and so is never excluded here.
const excludeNotePositionOnly: SQL = sql`not (${apMapEvent.kind} = 'note.updated' and jsonb_exists(${apMapEvent.payload}, 'positionX') and not jsonb_exists_any(${apMapEvent.payload}, array['content','severity','locked']))`;

// Audit attribution rolls every commit up to the acting character's account "main"
// — the human identity. Once an alt is re-homed onto a main's account (issue #116),
// its `user_id` repoints, so its prior commits reattribute to the main here at query
// time, matching the stats rollup. Falls back to the acting character when no main
// is recorded (and to the automation bucket when there is no acting character).
const auditMainChar = alias(apCharacter, 'audit_main_char');
/** Rolled-up actor id (SQL): the acting character's account main, else the acting id. */
const rolledActorId: SQL = sql`coalesce(${apUser.mainCharacterId}, ${apMapEvent.characterId})`;

function kindCategory(kind: MapEventKind): AuditEventCategory {
  // Every MapEventKind is `<category>.<verb>`; the prefix is one of the four.
  return kind.slice(0, kind.indexOf('.')) as AuditEventCategory;
}

function safeBigInt(value: string | null | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function encodeCursor(occurredAt: Date, id: bigint): string {
  return Buffer.from(`${occurredAt.toISOString()}|${id.toString()}`).toString('base64url');
}

function decodeCursor(cursor: string): { occurredAt: Date; id: bigint } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep < 0) return null;
    const occurredAt = new Date(raw.slice(0, sep));
    if (Number.isNaN(occurredAt.getTime())) return null;
    return { occurredAt, id: BigInt(raw.slice(sep + 1)) };
  } catch {
    return null;
  }
}

/**
 * Distinct actors who have ever committed to this map, with their event counts and
 * account-main rollup (so the dropdown can show "Alt (main: Main)"). Includes the
 * `characterId: null` automation bucket when present.
 */
export async function listAuditActors(mapId: bigint): Promise<AuditActor[]> {
  const rolledName: SQL<string | null> = sql`coalesce(${auditMainChar.name}, ${apCharacter.name})`;
  const rows = await db
    .select({
      characterId: sql<string | null>`${rolledActorId}`,
      name: rolledName,
      eventCount: sql<number>`count(*)::int`,
    })
    .from(apMapEvent)
    .leftJoin(apCharacter, eq(apMapEvent.characterId, apCharacter.id))
    .leftJoin(apUser, eq(apCharacter.userId, apUser.id))
    .leftJoin(auditMainChar, eq(apUser.mainCharacterId, auditMainChar.id))
    .where(eq(apMapEvent.mapId, mapId))
    .groupBy(rolledActorId, rolledName);

  return rows
    .map((r) => ({
      // int8 crosses the driver as a string already; keep it as-is.
      characterId: r.characterId ?? null,
      name: r.name ?? 'System / automation',
      eventCount: r.eventCount,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);
}

/** Shared filter clauses (everything except the keyset cursor). */
function filterClauses(params: AuditQueryParams): SQL[] {
  const clauses: SQL[] = [
    eq(apMapEvent.mapId, params.mapId),
    excludePositionOnly,
    excludeNotePositionOnly,
  ];
  if (params.characterId === 'none') {
    clauses.push(isNull(apMapEvent.characterId));
  } else if (params.characterId !== undefined) {
    // The id is an account main; match every commit by any character in that account.
    clauses.push(sql`${rolledActorId} = ${params.characterId}`);
  }
  if (params.kinds && params.kinds.length > 0) {
    clauses.push(inArray(apMapEvent.kind, params.kinds));
  }
  if (params.from) clauses.push(gte(apMapEvent.occurredAt, params.from));
  if (params.to) clauses.push(lte(apMapEvent.occurredAt, params.to));
  if (params.q && params.q.trim().length > 0) {
    const pat = `%${params.q.trim()}%`;
    clauses.push(
      or(
        ilike(apCharacter.name, pat),
        ilike(auditMainChar.name, pat),
        ilike(apMapEvent.kind, pat),
        sql`(${apMapEvent.payload} ->> 'sigId') ilike ${pat}`,
        sql`(${apMapEvent.payload} ->> 'name') ilike ${pat}`,
        sql`(${apMapEvent.payload} ->> 'alias') ilike ${pat}`,
        sql`(${apMapEvent.payload} ->> 'tag') ilike ${pat}`,
        sql`(${apMapEvent.payload} ->> 'title') ilike ${pat}`,
      )!,
    );
  }
  return clauses;
}

/**
 * Keyset-paginated audit feed for one map, newest first. Pages back through time
 * via an opaque `cursor` (encodes the last `(occurred_at, id)`), riding the
 * `(map_id, occurred_at DESC)` index. After fetching a page it resolves every
 * referenced system / connection-endpoint name in two batched queries, then renders
 * each row's human summary with the shared `describeMapEvent`.
 */
export async function queryAuditEvents(params: AuditQueryParams): Promise<AuditPage> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const clauses = filterClauses(params);

  if (params.cursor) {
    const c = decodeCursor(params.cursor);
    if (c) {
      clauses.push(
        or(
          lt(apMapEvent.occurredAt, c.occurredAt),
          and(eq(apMapEvent.occurredAt, c.occurredAt), lt(apMapEvent.id, c.id)),
        )!,
      );
    }
  }

  const fetched = await db
    .select({
      id: apMapEvent.id,
      occurredAt: apMapEvent.occurredAt,
      kind: apMapEvent.kind,
      payload: apMapEvent.payload,
      characterId: apMapEvent.characterId,
      mainCharacterId: apUser.mainCharacterId,
      characterName: apCharacter.name,
      mainName: auditMainChar.name,
    })
    .from(apMapEvent)
    .leftJoin(apCharacter, eq(apMapEvent.characterId, apCharacter.id))
    .leftJoin(apUser, eq(apCharacter.userId, apUser.id))
    .leftJoin(auditMainChar, eq(apUser.mainCharacterId, auditMainChar.id))
    .where(and(...clauses))
    .orderBy(desc(apMapEvent.occurredAt), desc(apMapEvent.id))
    .limit(limit + 1);

  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;

  const names = await resolveNames(page.map((r) => r.payload));

  const rows: AuditEventRow[] = page.map((r) => {
    const kind = r.kind as MapEventKind;
    // Attribute to the acting character's account main (issue #116), falling back
    // to the acting character itself when no main is recorded.
    const actorId = r.mainCharacterId ?? r.characterId;
    const actorName = r.mainName ?? r.characterName;
    const parsed = mapEventPayloadSchema.safeParse(r.payload);
    let action: string | null = null;
    if (parsed.success) {
      action = describeMapEvent(parsed.data, buildContext(parsed.data, actorName, names));
    }
    return {
      id: r.id.toString(),
      occurredAt: r.occurredAt.toISOString(),
      kind,
      category: kindCategory(kind),
      characterId: actorId?.toString() ?? null,
      characterName: actorName,
      // The actor lives in its own column — the summary is the action alone, with
      // the first letter capitalized so it reads as a standalone log line.
      summary: capitalize(action ?? fallbackSummary(kind)),
      destructive: DESTRUCTIVE_KINDS.has(kind),
    };
  });

  const last = page.at(-1);
  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor(last.occurredAt, last.id) : null,
  };
}

interface ResolvedNames {
  systemNameByMapSystemId: Map<string, string>;
}

/**
 * Batch-resolve every referenced system name for a page of payloads in one query.
 * Every system reference rides the payload as an `ap_map_system` id — including
 * the audit descriptors (connection endpoints, a signature's owning system)
 * embedded at mutation time — so even hard-deleted connections / signatures
 * resolve against the persistent `ap_map_system` rows (those rows soft-delete and
 * outlive every event that names them).
 */
async function resolveNames(payloads: unknown[]): Promise<ResolvedNames> {
  const mapSystemIds = new Set<bigint>();

  for (const raw of payloads) {
    const parsed = mapEventPayloadSchema.safeParse(raw);
    if (!parsed.success) continue;
    const ev = parsed.data;
    switch (ev.kind) {
      case 'system.added':
      case 'system.removed':
      case 'system.updated':
        addId(mapSystemIds, ev.id);
        break;
      case 'signature.create':
      case 'signature.update':
        addId(mapSystemIds, ev.mapSystemId);
        addId(mapSystemIds, ev.leadsToMapSystemId);
        break;
      case 'signature.delete':
        addId(mapSystemIds, ev.mapSystemId);
        break;
      case 'connection.create':
      case 'connection.update':
      case 'connection.delete':
        addId(mapSystemIds, ev.source);
        addId(mapSystemIds, ev.target);
        break;
      default:
        break;
    }
  }

  const systemNameByMapSystemId = new Map<string, string>();
  if (mapSystemIds.size > 0) {
    const rows = await db
      .select({ mapSystemId: apMapSystem.id, name: universeSystem.name })
      .from(apMapSystem)
      .innerJoin(universeSystem, eq(apMapSystem.systemId, universeSystem.id))
      .where(inArray(apMapSystem.id, [...mapSystemIds]));
    for (const row of rows) {
      systemNameByMapSystemId.set(row.mapSystemId.toString(), row.name);
    }
  }

  return { systemNameByMapSystemId };
}

function addId(set: Set<bigint>, value: string | null | undefined): void {
  const id = safeBigInt(value);
  if (id !== null) set.add(id);
}

/** Build the `describeMapEvent` naming context from the pre-resolved name maps. */
function buildContext(
  ev: MapEventPayload,
  characterName: string | null,
  names: ResolvedNames,
): WebhookEventContext {
  const nameOf = (value: string | null | undefined): string | null =>
    value ? (names.systemNameByMapSystemId.get(value) ?? null) : null;

  let systemName: string | null = null;
  let sourceSystemName: string | null = null;
  let targetSystemName: string | null = null;

  switch (ev.kind) {
    case 'system.added':
      systemName = ev.name;
      break;
    case 'system.removed':
    case 'system.updated':
      systemName = nameOf(ev.id);
      break;
    case 'signature.create':
    case 'signature.update':
      systemName = nameOf(ev.mapSystemId);
      // `targetSystemName` doubles as the sig's leads-to endpoint for the formatter.
      targetSystemName = nameOf(ev.leadsToMapSystemId);
      break;
    case 'signature.delete':
      systemName = nameOf(ev.mapSystemId);
      break;
    case 'connection.create':
    case 'connection.update':
    case 'connection.delete':
      sourceSystemName = nameOf(ev.source);
      targetSystemName = nameOf(ev.target);
      break;
    default:
      break;
  }

  // `mapName` is unused by describeMapEvent (only the Discord prefix needs it).
  return { mapName: '', characterName, systemName, sourceSystemName, targetSystemName };
}

/** Action phrasing (no actor) for events `describeMapEvent` declines (admin map.restore / map.purge). */
function fallbackSummary(kind: MapEventKind): string {
  switch (kind) {
    case 'map.restore':
      return 'restored the map';
    case 'map.purge':
      return 'permanently purged the map';
    default:
      return `made a change (${kind})`;
  }
}

/** Sentence-case the action phrase and end it with a period (the table's actor column carries the name). */
function capitalize(action: string): string {
  const trimmed = action.endsWith('.') ? action : `${action}.`;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Per-actor aggregate for the drill-down header: per-category counts, total, and a
 * highlighted destructive count. Honours the same position-only exclusion and
 * optional date window as the feed so the numbers match what the table shows.
 */
export async function auditActorSummary(
  mapId: bigint,
  characterId: bigint | 'none',
  from?: Date,
  to?: Date,
): Promise<ActorSummary> {
  const clauses: SQL[] = [eq(apMapEvent.mapId, mapId), excludePositionOnly, excludeNotePositionOnly];
  clauses.push(
    // The id is an account main; aggregate every commit by any character in it.
    characterId === 'none'
      ? isNull(apMapEvent.characterId)
      : sql`${rolledActorId} = ${characterId}`,
  );
  if (from) clauses.push(gte(apMapEvent.occurredAt, from));
  if (to) clauses.push(lte(apMapEvent.occurredAt, to));

  const rows = await db
    .select({ kind: apMapEvent.kind, count: sql<number>`count(*)::int` })
    .from(apMapEvent)
    .leftJoin(apCharacter, eq(apMapEvent.characterId, apCharacter.id))
    .leftJoin(apUser, eq(apCharacter.userId, apUser.id))
    .where(and(...clauses))
    .groupBy(apMapEvent.kind);

  const byCategory: Record<AuditEventCategory, number> = {
    system: 0,
    connection: 0,
    signature: 0,
    note: 0,
    map: 0,
  };
  let total = 0;
  let destructive = 0;
  for (const row of rows) {
    const kind = row.kind as MapEventKind;
    byCategory[kindCategory(kind)] += row.count;
    total += row.count;
    if (DESTRUCTIVE_KINDS.has(kind)) destructive += row.count;
  }
  return { total, destructive, byCategory };
}
