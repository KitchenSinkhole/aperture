import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapEvent,
  apMapSystem,
  apMapWebhook,
  universeSystem,
} from '@/db/schema';
import {
  postDiscordWebhook,
  type DiscordDispatchResult,
  type DiscordWebhookPayload,
} from '@/lib/integrations/discord';
import { recordWebhookDelivery } from '@/lib/metrics/registry';
import { mapEventPayloadSchema, type MapEventPayload } from '@/lib/realtime/protocol';
import type { WebhookOutcome } from '@/types';
import {
  formatHistoryMessage,
  formatRallyMessage,
  isRallySetEvent,
  type WebhookEventContext,
} from './formatters';

/**
 * Single-event Discord webhook dispatch. Invoked by the
 * `webhook-dispatch` graphile-worker task (one call per `ap_map_event` insert
 * on a map with at least one `ap_map_webhook` row).
 *
 * To never block the underlying map mutation, the
 * dispatcher NEVER throws — every per-webhook outcome is recorded on the
 * `ap_map_webhook` row's status columns and surfaced in the returned notes.
 * No automatic retries: graphile-worker would re-deliver to webhooks that
 * already succeeded, causing duplicate messages. `consecutive_failures`
 * accumulates across events; the admin UI is where auto-disable
 * policy lives.
 */

const LAST_ERROR_MAX = 500;

export interface WebhookDispatchNotes {
  /** Total webhook deliveries actually attempted for this event (formatter returned a payload). */
  attempted: number;
  succeeded: number;
  failed: number;
  /** Configured webhooks that the formatter declined to render (e.g. position-only update). */
  skipped: number;
  /** `true` when the event row could not be found at dispatch time (purged or never existed). */
  missingEvent?: true;
  /** `true` for the synthetic test-fire path triggered by the admin UI. */
  test?: true;
  /** `true` when a test fire targeted a webhook id that no longer exists. */
  missingWebhook?: true;
}

export async function runWebhookDispatch(
  mapId: bigint,
  eventId: bigint,
  occurredAt: Date,
): Promise<WebhookDispatchNotes> {
  const [eventRow] = await db
    .select({
      kind: apMapEvent.kind,
      payload: apMapEvent.payload,
      characterId: apMapEvent.characterId,
    })
    .from(apMapEvent)
    .where(
      and(
        eq(apMapEvent.mapId, mapId),
        eq(apMapEvent.id, eventId),
        eq(apMapEvent.occurredAt, occurredAt),
      ),
    );
  if (!eventRow) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, missingEvent: true };
  }

  const parsed = mapEventPayloadSchema.safeParse(eventRow.payload);
  if (!parsed.success) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  const event = parsed.data;

  const ctx = await resolveContext(mapId, event, eventRow.characterId);
  if (!ctx) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const isRally = isRallySetEvent(event);
  const webhooks = await db
    .select({
      id: apMapWebhook.id,
      channel: apMapWebhook.channel,
      event: apMapWebhook.event,
      url: apMapWebhook.url,
      username: apMapWebhook.username,
    })
    .from(apMapWebhook)
    .where(eq(apMapWebhook.mapId, mapId));

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const wh of webhooks) {
    // Rally webhooks only fire on rally-set events; rally-clear and other
    // system updates flow to history only.
    if (wh.event === 'rally' && !isRally) continue;
    if (wh.channel !== 'discord') continue;

    const payload =
      wh.event === 'rally'
        ? formatRallyMessage(event, ctx)
        : formatHistoryMessage(event, ctx);
    if (!payload) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    if (wh.username) payload.username = wh.username;

    const outcome = await deliver(wh.id, wh.url, payload);
    if (outcome.ok) succeeded += 1;
    else failed += 1;
  }

  return { attempted, succeeded, failed, skipped };
}

/**
 * Admin test-fire. Sends a synthetic `[test]` Discord payload to one
 * webhook and writes the outcome back to the same `ap_map_webhook` row a real
 * dispatch would touch (`last_status`, `last_error`, `last_attempted_at`,
 * `consecutive_failures`). Never throws.
 *
 * `sentAt` lets the admin UI prove the test it triggered is the one that
 * landed (the rendered message echoes it back). The dispatcher path is the
 * same `deliver()` helper used for real events — so a successful test fire
 * is exactly as much evidence as a successful real dispatch.
 */
export async function runTestWebhookDispatch(
  webhookId: bigint,
  sentAt: Date,
): Promise<WebhookDispatchNotes> {
  const [wh] = await db
    .select({
      channel: apMapWebhook.channel,
      url: apMapWebhook.url,
      username: apMapWebhook.username,
      mapId: apMapWebhook.mapId,
    })
    .from(apMapWebhook)
    .where(eq(apMapWebhook.id, webhookId));
  if (!wh) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, test: true, missingWebhook: true };
  }
  if (wh.channel !== 'discord') {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 1, test: true };
  }

  const [mapRow] = await db
    .select({ name: apMap.name })
    .from(apMap)
    .where(eq(apMap.id, wh.mapId));
  const mapName = mapRow?.name ?? `map ${wh.mapId.toString()}`;

  const payload: DiscordWebhookPayload = {
    content: `**${mapName}** — [test] Aperture webhook test fired at ${sentAt.toISOString()}.`,
  };
  if (wh.username) payload.username = wh.username;

  const outcome = await deliver(webhookId, wh.url, payload);
  return {
    attempted: 1,
    succeeded: outcome.ok ? 1 : 0,
    failed: outcome.ok ? 0 : 1,
    skipped: 0,
    test: true,
  };
}

/** Map a Discord dispatch result to its bounded `webhook_deliveries_total` outcome. */
function webhookOutcome(result: DiscordDispatchResult): WebhookOutcome {
  if (result.ok) return 'success';
  if (result.status === 429) return 'rate_limited';
  if (result.status === undefined) return 'network_error';
  if (result.status >= 500) return 'http_5xx';
  return 'http_4xx';
}

async function deliver(
  webhookId: bigint,
  url: string,
  payload: DiscordWebhookPayload,
): Promise<{ ok: boolean }> {
  const result = await postDiscordWebhook(url, payload);
  recordWebhookDelivery(webhookOutcome(result));
  const attemptedAt = new Date();

  if (result.ok) {
    await db
      .update(apMapWebhook)
      .set({
        lastStatus: result.status,
        lastError: null,
        lastAttemptedAt: attemptedAt,
        consecutiveFailures: 0,
        updatedAt: attemptedAt,
      })
      .where(eq(apMapWebhook.id, webhookId));
    return { ok: true };
  }

  await db
    .update(apMapWebhook)
    .set({
      lastStatus: result.status ?? null,
      lastError: result.error.slice(0, LAST_ERROR_MAX),
      lastAttemptedAt: attemptedAt,
      consecutiveFailures: sql`${apMapWebhook.consecutiveFailures} + 1`,
      updatedAt: attemptedAt,
    })
    .where(eq(apMapWebhook.id, webhookId));
  return { ok: false };
}

async function resolveContext(
  mapId: bigint,
  event: MapEventPayload,
  characterId: bigint | null,
): Promise<WebhookEventContext | null> {
  const [mapRow] = await db.select({ name: apMap.name }).from(apMap).where(eq(apMap.id, mapId));
  if (!mapRow) return null;

  let characterName: string | null = null;
  if (characterId !== null) {
    const [charRow] = await db
      .select({ name: apCharacter.name })
      .from(apCharacter)
      .where(eq(apCharacter.id, characterId));
    characterName = charRow?.name ?? null;
  }

  const refs = collectSystemRefs(event);
  const systemNamesById = refs.mapSystemIds.length
    ? await loadSystemNames(refs.mapSystemIds)
    : new Map<bigint, string>();

  // `system.added` carries the EVE system name in the payload itself.
  const payloadSystemName = event.kind === 'system.added' ? event.name : null;

  return {
    mapName: mapRow.name,
    characterName,
    systemName:
      payloadSystemName ??
      (refs.primaryMapSystemId
        ? (systemNamesById.get(refs.primaryMapSystemId) ?? null)
        : null),
    sourceSystemName: refs.sourceMapSystemId
      ? (systemNamesById.get(refs.sourceMapSystemId) ?? null)
      : null,
    targetSystemName: refs.targetMapSystemId
      ? (systemNamesById.get(refs.targetMapSystemId) ?? null)
      : null,
  };
}

function collectSystemRefs(event: MapEventPayload): {
  primaryMapSystemId: bigint | null;
  sourceMapSystemId: bigint | null;
  targetMapSystemId: bigint | null;
  mapSystemIds: bigint[];
} {
  let primaryMapSystemId: bigint | null = null;
  let sourceMapSystemId: bigint | null = null;
  let targetMapSystemId: bigint | null = null;

  switch (event.kind) {
    case 'system.added':
    case 'system.removed':
    case 'system.updated':
      primaryMapSystemId = safeBigInt(event.id);
      break;
    case 'connection.create':
    case 'connection.update':
    case 'connection.delete':
      // Endpoint ids ride the payload (the create body, and the audit descriptors
      // added to update/delete) so the hole is named even after it's hard-deleted.
      sourceMapSystemId = safeBigInt(event.source);
      targetMapSystemId = safeBigInt(event.target);
      break;
    case 'signature.create':
    case 'signature.update':
      // `mapSystemId` rides every signature payload; `leadsToMapSystemId` (when the
      // sig is/was linked) names the destination — both resolve without a join.
      primaryMapSystemId = safeBigInt(event.mapSystemId);
      targetMapSystemId = safeBigInt(event.leadsToMapSystemId);
      break;
    case 'signature.delete':
      primaryMapSystemId = safeBigInt(event.mapSystemId);
      break;
    default:
      break;
  }

  return {
    primaryMapSystemId,
    sourceMapSystemId,
    targetMapSystemId,
    mapSystemIds: uniqueBigInts([primaryMapSystemId, sourceMapSystemId, targetMapSystemId]),
  };
}

async function loadSystemNames(mapSystemIds: bigint[]): Promise<Map<bigint, string>> {
  const rows = await db
    .select({
      mapSystemId: apMapSystem.id,
      name: universeSystem.name,
    })
    .from(apMapSystem)
    .innerJoin(universeSystem, eq(apMapSystem.systemId, universeSystem.id))
    .where(inArray(apMapSystem.id, mapSystemIds));
  return new Map(rows.map((r) => [r.mapSystemId, r.name]));
}

function uniqueBigInts(input: Array<bigint | null>): bigint[] {
  const out: bigint[] = [];
  const seen = new Set<string>();
  for (const v of input) {
    if (v === null) continue;
    const key = v.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function safeBigInt(str: string | null | undefined): bigint | null {
  if (!str) return null;
  try {
    return BigInt(str);
  } catch {
    return null;
  }
}
