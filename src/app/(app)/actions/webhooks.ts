'use server';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { apMapWebhook, apWebhookChannel, apWebhookEvent } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { canUseMapFeature } from '@/lib/auth/rights';

/**
 * Map-scoped actions on `ap_map_webhook` rows, gated by the `webhooks_manage`
 * capability — held implicitly by a manager (private-map owner, owning-corp
 * Director, owning-alliance executor-corp Director, or admin) and grantable to a
 * specific corp title via `ap_map_role_access`. Surfaced in the in-map
 * Settings → Webhooks tab; the admin panel no longer owns webhook config.
 *
 * No `ap_map_event` row is written — webhook subscriptions are infrastructure,
 * not map state. The Webhooks tab refetches `GET /api/map/[mapId]/webhooks`
 * after every mutation, so there is no `revalidatePath` here.
 */

const mapIdSchema = z.string().regex(/^\d+$/, 'Invalid map id.');
const webhookIdSchema = z.string().regex(/^\d+$/, 'Invalid webhook id.');
const channelSchema = z.enum(apWebhookChannel.enumValues);
const eventSchema = z.enum(apWebhookEvent.enumValues);
const urlSchema = z.string().url('Webhook URL must be a valid URL.').max(2000);
const usernameSchema = z
  .string()
  .trim()
  .max(80)
  .transform((s) => (s.length === 0 ? null : s))
  .nullable()
  .optional();

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

/** Resolve the session character and confirm it may manage this map's webhooks. */
async function gateForMap(mapId: bigint): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();
  if (!(await canUseMapFeature(BigInt(session.characterId), mapId, 'webhooks_manage'))) {
    return { ok: false, error: 'Forbidden.' };
  }
  return { ok: true };
}

/** Resolve the webhook's owning map, then confirm the session can manage it. */
async function gateForWebhook(
  webhookId: bigint,
): Promise<{ ok: true; mapId: bigint } | { ok: false; error: string }> {
  const [row] = await db
    .select({ mapId: apMapWebhook.mapId })
    .from(apMapWebhook)
    .where(eq(apMapWebhook.id, webhookId));
  if (!row) return { ok: false, error: 'Webhook not found.' };

  const gate = await gateForMap(row.mapId);
  if (!gate.ok) return gate;
  return { ok: true, mapId: row.mapId };
}

const createSchema = z.object({
  mapId: mapIdSchema,
  channel: channelSchema,
  event: eventSchema,
  url: urlSchema,
  username: usernameSchema,
});

/**
 * Insert a new `ap_map_webhook` row. Bound by the
 * `ap_map_webhook_map_channel_event_uq` unique constraint — duplicate
 * (map, channel, event) tuples surface as a clear conflict message.
 */
export async function createWebhook(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const mapId = BigInt(parsed.data.mapId);
  const gate = await gateForMap(mapId);
  if (!gate.ok) return gate;

  try {
    const [row] = await db
      .insert(apMapWebhook)
      .values({
        mapId,
        channel: parsed.data.channel,
        event: parsed.data.event,
        url: parsed.data.url,
        username: parsed.data.username ?? null,
      })
      .returning({ id: apMapWebhook.id });
    return { ok: true, data: { id: row!.id.toString() } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Insert failed.';
    if (/ap_map_webhook_map_channel_event_uq/.test(message)) {
      return {
        ok: false,
        error: 'A webhook for this map / channel / event already exists.',
      };
    }
    return { ok: false, error: message };
  }
}

const updateSchema = z.object({
  id: webhookIdSchema,
  url: urlSchema.optional(),
  username: usernameSchema,
});

/**
 * Patch the URL or username on an existing webhook row. Channel + event are
 * immutable (delete + recreate to change those).
 */
export async function updateWebhook(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const id = BigInt(parsed.data.id);
  const gate = await gateForWebhook(id);
  if (!gate.ok) return gate;

  const patch: Partial<{ url: string; username: string | null }> = {};
  if (parsed.data.url !== undefined) patch.url = parsed.data.url;
  if (parsed.data.username !== undefined) patch.username = parsed.data.username;
  if (Object.keys(patch).length === 0) return { ok: true };

  await db
    .update(apMapWebhook)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(apMapWebhook.id, id));

  return { ok: true };
}

/**
 * Hard-delete a webhook row. Per CLAUDE.md "lifecycle patterns", there is no
 * `active` flag — unsubscribing == removing the row.
 */
export async function deleteWebhook(id: string): Promise<ActionResult> {
  const parsed = webhookIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const webhookId = BigInt(parsed.data);
  const gate = await gateForWebhook(webhookId);
  if (!gate.ok) return gate;

  await db.delete(apMapWebhook).where(eq(apMapWebhook.id, webhookId));
  return { ok: true };
}

/**
 * Zero `consecutive_failures` and clear `last_error` — dismiss a failure flag
 * after fixing the URL or the channel permissions. Deliberately leaves
 * `last_status` / `last_attempted_at` as the last actual delivery's facts.
 */
export async function resetWebhookFailures(id: string): Promise<ActionResult> {
  const parsed = webhookIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const webhookId = BigInt(parsed.data);
  const gate = await gateForWebhook(webhookId);
  if (!gate.ok) return gate;

  await db
    .update(apMapWebhook)
    .set({ consecutiveFailures: 0, lastError: null, updatedAt: new Date() })
    .where(eq(apMapWebhook.id, webhookId));

  return { ok: true };
}

/**
 * Enqueue a synthetic `webhook-dispatch` job that targets this single webhook
 * with a `[test]` Discord message. The job handler detects the `test: true`
 * discriminator and calls `runTestWebhookDispatch`, which writes back
 * `last_status` / `last_attempted_at` / `consecutive_failures` exactly like a
 * real dispatch. Returns once the job is enqueued — the actual POST happens on
 * the worker tick; the panel refetches to surface the new health badge.
 */
export async function testWebhook(id: string): Promise<ActionResult> {
  const parsed = webhookIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const webhookId = BigInt(parsed.data);
  const gate = await gateForWebhook(webhookId);
  if (!gate.ok) return gate;

  const sentAt = new Date().toISOString();
  await db.execute(sql`
    SELECT graphile_worker.add_job(
      'webhook-dispatch',
      json_build_object(
        'test', true,
        'webhookId', ${webhookId.toString()}::text,
        'sentAt', ${sentAt}::text
      )
    )
  `);

  return { ok: true };
}
