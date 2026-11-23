// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { runMigrations } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apJobRun,
  apMap,
  apMapEvent,
  apMapSystem,
  apMapWebhook,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import { commitMapEvent, enqueueWebhookDispatch } from '@/lib/map/mutations/core';
import { runWebhookDispatch } from '@/lib/webhooks/dispatcher';

/**
 * DB-gated:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * Covers: per-event dispatch (success, retriable 5xx, terminal 404, a stored
 * non-Discord URL refused without a fetch), the
 * rally-vs-history routing rule, the no-webhook short-circuit in
 * `commitMapEvent`, the graphile-worker enqueue when a webhook exists, a
 * joined-tx event enqueued without its timestamp reaching Discord, and
 * audit-only token events neither enqueued nor posted.
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98140001;
const CONSTELLATION = 98140001;
const SYS_A = 98140001;
const SYS_B = 98140002;

let mapId = 0n;
let mapSystemA = 0n;

const originalFetch = globalThis.fetch;
const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];

function mockFetchOnce(status = 204, body = '') {
  // Node 24's undici enforces "null body status" for 204/205/304 — Response
  // construction throws if a body is passed alongside one of those statuses.
  const nullBody = status === 204 || status === 205 || status === 304;
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url: String(url), init: init as RequestInit | undefined });
    return new Response(nullBody ? null : body, { status });
  }) as unknown as typeof fetch;
}

describe.skipIf(!run)('Stage 14 webhook dispatch (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    // graphile-worker installs its own schema; commitMapEvent's
    // `graphile_worker.add_job` call needs it to exist.
    await runMigrations({ pgPool: pool });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Webhook Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Webhook Test Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'Webhook System A', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'Webhook System B', security: 'H' },
    ]);

    const [m] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: 'webhook-test-map' })
      .returning({ id: apMap.id });
    mapId = m!.id;

    const [sa] = await db
      .insert(apMapSystem)
      .values({ mapId, systemId: SYS_A, visible: true })
      .returning({ id: apMapSystem.id });
    mapSystemA = sa!.id;
    // A second system seeded so connection-event scenarios have an endpoint
    // pair available without re-seeding (no current test consumes the id).
    await db.insert(apMapSystem).values({ mapId, systemId: SYS_B, visible: true });
  });

  afterAll(async () => {
    await cleanup();
    globalThis.fetch = originalFetch;
    await pool.end();
  });

  beforeEach(async () => {
    // Each test starts with no webhooks; individual tests insert what they need.
    await db.delete(apMapWebhook).where(eq(apMapWebhook.mapId, mapId));
    await db.delete(apJobRun);
    await db.execute(sql`DELETE FROM graphile_worker._private_jobs WHERE task_id = (SELECT id FROM graphile_worker._private_tasks WHERE identifier = 'webhook-dispatch')`);
    fetchCalls.length = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('records a 204 success and resets consecutive_failures', async () => {
    const [wh] = await db
      .insert(apMapWebhook)
      .values({
        mapId,
        channel: 'discord',
        event: 'history',
        url: 'https://discord.com/api/webhooks/1/A',
        consecutiveFailures: 3,
      })
      .returning({ id: apMapWebhook.id });

    mockFetchOnce(204);
    const event = await insertMockEvent('system.removed', { id: mapSystemA.toString() });

    const notes = await runWebhookDispatch(mapId, event.id, event.occurredAt);
    expect(notes).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe('https://discord.com/api/webhooks/1/A');

    const [updated] = await db
      .select({
        lastStatus: apMapWebhook.lastStatus,
        lastError: apMapWebhook.lastError,
        consecutiveFailures: apMapWebhook.consecutiveFailures,
        lastAttemptedAt: apMapWebhook.lastAttemptedAt,
      })
      .from(apMapWebhook)
      .where(eq(apMapWebhook.id, wh!.id));
    expect(updated!.lastStatus).toBe(204);
    expect(updated!.lastError).toBeNull();
    expect(updated!.consecutiveFailures).toBe(0);
    expect(updated!.lastAttemptedAt).not.toBeNull();
  });

  it('records a 404 as a terminal failure without throwing', async () => {
    const [wh] = await db
      .insert(apMapWebhook)
      .values({
        mapId,
        channel: 'discord',
        event: 'history',
        url: 'https://discord.com/api/webhooks/1/gone',
      })
      .returning({ id: apMapWebhook.id });

    mockFetchOnce(404, 'Unknown Webhook');
    const event = await insertMockEvent('system.removed', { id: mapSystemA.toString() });

    const notes = await runWebhookDispatch(mapId, event.id, event.occurredAt);
    expect(notes).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });

    const [updated] = await db
      .select({
        lastStatus: apMapWebhook.lastStatus,
        lastError: apMapWebhook.lastError,
        consecutiveFailures: apMapWebhook.consecutiveFailures,
      })
      .from(apMapWebhook)
      .where(eq(apMapWebhook.id, wh!.id));
    expect(updated!.lastStatus).toBe(404);
    expect(updated!.lastError).toBe('Unknown Webhook');
    expect(updated!.consecutiveFailures).toBe(1);
  });

  it('refuses a stored non-Discord URL without fetching it', async () => {
    const [wh] = await db
      .insert(apMapWebhook)
      .values({
        mapId,
        channel: 'discord',
        event: 'history',
        url: 'http://169.254.169.254/latest/meta-data/',
      })
      .returning({ id: apMapWebhook.id });

    mockFetchOnce(200, 'secret');
    const event = await insertMockEvent('system.removed', { id: mapSystemA.toString() });

    const notes = await runWebhookDispatch(mapId, event.id, event.occurredAt);
    expect(notes).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(fetchCalls).toHaveLength(0);

    const [updated] = await db
      .select({
        lastStatus: apMapWebhook.lastStatus,
        lastError: apMapWebhook.lastError,
        consecutiveFailures: apMapWebhook.consecutiveFailures,
      })
      .from(apMapWebhook)
      .where(eq(apMapWebhook.id, wh!.id));
    expect(updated!.lastStatus).toBeNull();
    expect(updated!.lastError).toBe('Not a Discord webhook URL; delivery refused.');
    expect(updated!.consecutiveFailures).toBe(1);
  });

  it('records a 503 as a failure but still ends successfully (no retry)', async () => {
    const [wh] = await db
      .insert(apMapWebhook)
      .values({
        mapId,
        channel: 'discord',
        event: 'history',
        url: 'https://discord.com/api/webhooks/1/down',
      })
      .returning({ id: apMapWebhook.id });

    mockFetchOnce(503, 'Service Unavailable');
    const event = await insertMockEvent('system.removed', { id: mapSystemA.toString() });

    const notes = await runWebhookDispatch(mapId, event.id, event.occurredAt);
    expect(notes).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });

    const [updated] = await db
      .select({ lastStatus: apMapWebhook.lastStatus, consecutiveFailures: apMapWebhook.consecutiveFailures })
      .from(apMapWebhook)
      .where(eq(apMapWebhook.id, wh!.id));
    expect(updated!.lastStatus).toBe(503);
    expect(updated!.consecutiveFailures).toBe(1);
  });

  it('routes rally-set events to rally webhooks and skips them on rally-clear', async () => {
    await db.insert(apMapWebhook).values([
      {
        mapId,
        channel: 'discord',
        event: 'history',
        url: 'https://discord.com/api/webhooks/1/history',
      },
      {
        mapId,
        channel: 'discord',
        event: 'rally',
        url: 'https://discord.com/api/webhooks/1/rally',
      },
    ]);

    // Rally set: both history + rally fire.
    mockFetchOnce(204);
    const set = await insertMockEvent('system.updated', {
      id: mapSystemA.toString(),
      rallyAt: '2026-05-27T12:00:00.000Z',
    });
    const setNotes = await runWebhookDispatch(mapId, set.id, set.occurredAt);
    expect(setNotes.attempted).toBe(2);
    expect(setNotes.succeeded).toBe(2);
    expect(fetchCalls.map((c) => c.url).sort()).toEqual([
      'https://discord.com/api/webhooks/1/history',
      'https://discord.com/api/webhooks/1/rally',
    ]);

    // Rally cleared: only history fires.
    fetchCalls.length = 0;
    mockFetchOnce(204);
    const clear = await insertMockEvent('system.updated', {
      id: mapSystemA.toString(),
      rallyAt: null,
    });
    const clearNotes = await runWebhookDispatch(mapId, clear.id, clear.occurredAt);
    expect(clearNotes.attempted).toBe(1);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe('https://discord.com/api/webhooks/1/history');
  });

  it('returns missingEvent when the event row is not found', async () => {
    await db.insert(apMapWebhook).values({
      mapId,
      channel: 'discord',
      event: 'history',
      url: 'https://discord.com/api/webhooks/1/A',
    });
    const notes = await runWebhookDispatch(mapId, 999_999_999n, new Date());
    expect(notes.missingEvent).toBe(true);
    expect(fetchCalls).toHaveLength(0);
  });

  it('posts a joined-tx event enqueued without its timestamp', async () => {
    await db.insert(apMapWebhook).values({
      mapId,
      channel: 'discord',
      event: 'history',
      url: 'https://discord.com/api/webhooks/1/A',
    });
    const eventId = await db.transaction(async (tx) => {
      const committed = await commitMapEvent({
        tx,
        mapId,
        characterId: null,
        kind: 'api.enabled',
        mutate: async () => ({ scopes: ['map' as const] }),
      });
      if (!committed.ok) throw new Error(committed.error);
      return committed.eventId;
    });
    expect(await countQueuedJobs()).toBe(0);

    await enqueueWebhookDispatch(mapId, eventId);
    expect(await countQueuedJobs()).toBe(1);
    const job = await firstQueuedJob();
    const queued = job.payload as { eventId: string; occurredAt: string };
    const [row] = await db
      .select({ occurredAt: apMapEvent.occurredAt })
      .from(apMapEvent)
      .where(eq(apMapEvent.id, BigInt(eventId)));
    expect(queued.occurredAt).toBe(row!.occurredAt.toISOString());

    mockFetchOnce(204);
    const notes = await runWebhookDispatch(mapId, BigInt(queued.eventId), new Date(queued.occurredAt));
    expect(notes).toMatchObject({ attempted: 1, succeeded: 1 });
    expect(String(fetchCalls[0]!.init?.body).toLowerCase()).toContain('enabled the user api');
  });

  it('never posts or enqueues an audit-only token event', async () => {
    await db.insert(apMapWebhook).values({
      mapId,
      channel: 'discord',
      event: 'history',
      url: 'https://discord.com/api/webhooks/1/A',
    });
    const result = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'api.token_created',
      mutate: async () => ({ tokenId: '1', label: '@everyone', scopes: ['map' as const], expiresAt: null }),
    });
    expect(result.ok).toBe(true);
    expect(await countQueuedJobs()).toBe(0);

    const ev = await insertMockEvent('api.token_revoked', {
      tokenId: '1',
      label: 'chain bot',
      reason: 'manager',
    });
    mockFetchOnce(204);
    const notes = await runWebhookDispatch(mapId, ev.id, ev.occurredAt);
    expect(notes).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(fetchCalls).toHaveLength(0);
  });

  it('commitMapEvent enqueues a webhook-dispatch job only when a webhook exists', async () => {
    // No webhook configured → no enqueue.
    await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'system.removed',
      mutate: async () => ({ id: mapSystemA.toString() }),
    });
    expect(await countQueuedJobs()).toBe(0);

    // Insert a webhook and commit another event → one enqueue.
    await db.insert(apMapWebhook).values({
      mapId,
      channel: 'discord',
      event: 'history',
      url: 'https://discord.com/api/webhooks/1/A',
    });
    const result = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'system.removed',
      mutate: async () => ({ id: mapSystemA.toString() }),
    });
    expect(result.ok).toBe(true);
    expect(await countQueuedJobs()).toBe(1);

    const job = await firstQueuedJob();
    expect(job.task_identifier).toBe('webhook-dispatch');
    const payload = job.payload as { mapId: string; eventId: string; occurredAt: string };
    expect(payload.mapId).toBe(mapId.toString());
    expect(payload.eventId).toBe(result.ok ? result.eventId.toString() : '');
    expect(typeof payload.occurredAt).toBe('string');
  });
});

interface InsertedEvent {
  id: bigint;
  occurredAt: Date;
}

async function insertMockEvent(
  kind: string,
  patch: Record<string, unknown>,
): Promise<InsertedEvent> {
  const [seq] = (
    await db.execute(sql`SELECT nextval(pg_get_serial_sequence('ap_map_event','id')) AS id`)
  ).rows as Array<{ id: string }>;
  const eventId = BigInt(seq!.id);
  const occurredAt = new Date();
  await db
    .insert(apMapEvent)
    .values({
      id: eventId,
      mapId,
      characterId: null,
      occurredAt,
      kind,
      payload: { kind, eventId: Number(eventId), ...patch },
    });
  return { id: eventId, occurredAt };
}

async function countQueuedJobs(): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM graphile_worker.jobs WHERE task_identifier = 'webhook-dispatch'`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function firstQueuedJob(): Promise<{ task_identifier: string; payload: unknown }> {
  // The public `jobs` view exposes meta columns only; reach into
  // `_private_jobs` for the json payload, joined with `_private_tasks` for the
  // task identifier.
  const rows = (
    await db.execute(
      sql`SELECT t.identifier AS task_identifier, j.payload
          FROM graphile_worker._private_jobs j
          JOIN graphile_worker._private_tasks t ON t.id = j.task_id
          WHERE t.identifier = 'webhook-dispatch'
          ORDER BY j.id LIMIT 1`,
    )
  ).rows as Array<{ task_identifier: string; payload: unknown }>;
  return rows[0] as { task_identifier: string; payload: unknown };
}

async function cleanup() {
  // Wipe any prior test state — also strips ap_map_event partitions via cascade.
  await db.delete(apMap).where(sql`name like 'webhook-test-%'`);
  await db.delete(universeSystem).where(sql`id in (${SYS_A}, ${SYS_B})`);
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
  await db.delete(apJobRun);
  // Clean graphile_worker queue if the schema exists (test isolation across runs).
  try {
    await db.execute(sql`DELETE FROM graphile_worker._private_jobs WHERE task_id = (SELECT id FROM graphile_worker._private_tasks WHERE identifier = 'webhook-dispatch')`);
  } catch {
    // Schema not yet installed — ignore.
  }
}
