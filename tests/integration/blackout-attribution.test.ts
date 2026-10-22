// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apInstance,
  apMap,
  apMapEvent,
  apMapSystem,
  apMapWebhook,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';

/**
 * Blackout attribution (real Postgres): Discord posts made while Blackout is on
 * name no actor, and the audit console hides actors from viewers it restricts.
 *
 * `ap_instance` is a live singleton, so the switch is snapshotted in `beforeAll`
 * and restored in `afterAll`. Ids use a 9727xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test blackout-attribution
 */
const run = process.env.RUN_DB_TESTS === '1';

let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => currentSession) }));

const { runWebhookDispatch } = await import('@/lib/webhooks/dispatcher');
const { GET: auditRoute } = await import('@/app/api/map/[mapId]/audit/route');

const REGION = 97270001;
const CONSTELLATION = 97270001;
const SYS_A = 97270001;

const OWNER_CHAR = 97270001n; // private-map owner: holds audit_view, not cleared
const ADMIN_CHAR = 97270002n; // global admin: holds audit_view, implicitly cleared
const characterIds = [OWNER_CHAR, ADMIN_CHAR];
const OWNER_NAME = 'Attribution Owner';
const ADMIN_NAME = 'Attribution Admin';

const MAP_NAME = 'Blackout Attribution Map';

const accounts = { owner: 0, admin: 0 };
let mapId = 0n;
let mapSystemA = 0n;
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

const originalFetch = globalThis.fetch;
const posted: Array<Record<string, unknown>> = [];

function mockDiscord() {
  globalThis.fetch = vi.fn(async (_url, init) => {
    posted.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
}

function asSession(characterId: bigint, userId: number): Session {
  return { characterId: characterId.toString(), userId, user: { id: '0' } } as unknown as Session;
}

async function setSwitch(on: boolean): Promise<void> {
  await db
    .update(apInstance)
    .set({ blackoutSince: on ? new Date() : null, blackoutByCharacterId: null })
    .where(eq(apInstance.id, 1));
}

async function insertEvent(
  kind: string,
  characterId: bigint | null,
  patch: Record<string, unknown>,
): Promise<{ id: bigint; occurredAt: Date }> {
  const [seq] = (
    await db.execute(sql`SELECT nextval(pg_get_serial_sequence('ap_map_event','id')) AS id`)
  ).rows as Array<{ id: string }>;
  const id = BigInt(seq!.id);
  const occurredAt = new Date();
  await db.insert(apMapEvent).values({
    id,
    mapId,
    characterId,
    occurredAt,
    kind,
    payload: { kind, eventId: Number(id), ...patch },
  });
  return { id, occurredAt };
}

interface AuditBody {
  ok: boolean;
  data: {
    rows: Array<Record<string, unknown>>;
    actorSummary: unknown;
    actors?: Array<{ characterId: string | null; name: string }>;
    actorsHidden?: boolean;
  };
}

async function callAudit(query = ''): Promise<AuditBody> {
  const res = await auditRoute(
    new NextRequest(`http://localhost/api/map/${mapId}/audit${query}`),
    { params: Promise.resolve({ mapId: mapId.toString() }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as AuditBody;
}

describe.skipIf(!run)('Blackout attribution (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Attribution Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Attribution Const' });
    await db
      .insert(universeSystem)
      .values({ id: SYS_A, constellationId: CONSTELLATION, name: 'BAT A', security: 'C3' });

    for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) {
      const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
      accounts[key] = u!.id;
    }
    await db.insert(apCharacter).values([
      mkChar(OWNER_CHAR, accounts.owner, OWNER_NAME, 'member'),
      mkChar(ADMIN_CHAR, accounts.admin, ADMIN_NAME, 'admin'),
    ]);

    const [m] = await db
      .insert(apMap)
      .values({ name: MAP_NAME, scope: 'wh', type: 'private', ownerCharacterId: OWNER_CHAR })
      .returning({ id: apMap.id });
    mapId = m!.id;
    const [s] = await db
      .insert(apMapSystem)
      .values({ mapId, systemId: SYS_A, visible: true })
      .returning({ id: apMapSystem.id });
    mapSystemA = s!.id;

    await db.insert(apMapWebhook).values({
      mapId,
      channel: 'discord',
      event: 'history',
      url: 'https://discord.example/webhooks/attribution',
    });

    await insertEvent('system.removed', OWNER_CHAR, { id: mapSystemA.toString() });
  });

  afterAll(async () => {
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          blackoutSince: instanceSnapshot.blackoutSince,
          blackoutByCharacterId: instanceSnapshot.blackoutByCharacterId,
        })
        .where(eq(apInstance.id, 1));
    }
    globalThis.fetch = originalFetch;
    await pool.end();
  });

  beforeEach(async () => {
    await setSwitch(false);
    posted.length = 0;
    currentSession = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Discord history posts', () => {
    it('name the actor while Blackout is off', async () => {
      mockDiscord();
      const event = await insertEvent('system.removed', OWNER_CHAR, { id: mapSystemA.toString() });
      const notes = await runWebhookDispatch(mapId, event.id, event.occurredAt);
      expect(notes).toMatchObject({ attempted: 1, succeeded: 1 });
      expect(posted[0]!.content).toBe(`**${MAP_NAME}** — ${OWNER_NAME} removed **BAT A** from the map.`);
    });

    it('carry no character name while Blackout is on', async () => {
      await setSwitch(true);
      mockDiscord();
      const event = await insertEvent('system.removed', OWNER_CHAR, { id: mapSystemA.toString() });
      const notes = await runWebhookDispatch(mapId, event.id, event.occurredAt);
      expect(notes).toMatchObject({ attempted: 1, succeeded: 1 });
      expect(posted[0]!.content).toBe(`**${MAP_NAME}** — Removed **BAT A** from the map.`);
      expect(JSON.stringify(posted[0])).not.toContain(OWNER_NAME);
    });
  });

  describe('audit console', () => {
    it('hides actors from a non-cleared viewer while Blackout is on', async () => {
      await setSwitch(true);
      currentSession = asSession(OWNER_CHAR, accounts.owner);

      const body = await callAudit();
      expect(body.data.actorsHidden).toBe(true);
      expect(body.data.actors).toBeUndefined();
      expect(body.data.actorSummary).toBeNull();
      expect(body.data.rows.length).toBeGreaterThan(0);
      for (const row of body.data.rows) {
        expect(row).not.toHaveProperty('characterId');
        expect(row).not.toHaveProperty('characterName');
      }
      expect(JSON.stringify(body)).not.toContain(OWNER_NAME);

      // Neither an actor filter nor an actor-name search narrows the feed.
      const filtered = await callAudit(`?characterId=${OWNER_CHAR}`);
      expect(filtered.data.rows.length).toBe(body.data.rows.length);
      expect(filtered.data.actorSummary).toBeNull();
      const searched = await callAudit(`?q=${encodeURIComponent(OWNER_NAME)}`);
      expect(searched.data.rows).toHaveLength(0);
    });

    it('shows actors to a cleared viewer while Blackout is on', async () => {
      await setSwitch(true);
      currentSession = asSession(ADMIN_CHAR, accounts.admin);
      await expectActorsVisible();
    });

    it('shows actors to everyone once Blackout is off', async () => {
      currentSession = asSession(OWNER_CHAR, accounts.owner);
      await expectActorsVisible();
    });
  });
});

async function expectActorsVisible(): Promise<void> {
  const body = await callAudit();
  expect(body.data.actorsHidden).toBeUndefined();
  expect(body.data.rows[0]).toMatchObject({
    characterId: OWNER_CHAR.toString(),
    characterName: OWNER_NAME,
  });
  expect(body.data.actors?.map((a) => a.name)).toContain(OWNER_NAME);

  const drill = await callAudit(`?characterId=${OWNER_CHAR}`);
  expect(drill.data.actorSummary).not.toBeNull();
}

function mkChar(id: bigint, userId: number, name: string, authzLevel: 'member' | 'admin') {
  return {
    id,
    userId,
    name,
    ownerHash: `attribution-hash-${id.toString()}`,
    authzLevel,
    status: 'active' as const,
    corporationId: 97279001n,
    allianceId: null,
  };
}

async function cleanup() {
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  const userIds = [...new Set([...users.map((u) => u.userId), ...Object.values(accounts)])].filter(
    (id) => id !== 0,
  );
  if (userIds.length) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(universeSystem).where(eq(universeSystem.id, SYS_A));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
