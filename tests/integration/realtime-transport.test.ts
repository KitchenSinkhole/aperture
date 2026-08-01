// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { encode } from 'next-auth/jwt';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apCharacter, apCharacterPresence, apMap, apMapEvent, apUser } from '@/db/schema';
import { env } from '@/lib/env';
import { apertureConfig } from '../../aperture.config';
import { attachWsServer } from '@/lib/realtime/wsServer';
import type { ServerToClientMessage } from '@/lib/realtime/protocol';

/**
 * Two tabs subscribed to the same map see each other's
 * `pg_notify` messages within <500ms; an upgrade without a valid session is
 * rejected; subscribing to a soft-deleted/nonexistent map delivers nothing.
 * Gated behind RUN_DB_TESTS (needs containerized Postgres + applied migrations):
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';
const COOKIE_NAME = 'authjs.session-token';

const PRESENCE_CHARACTER_ID = 99620001n;

async function sessionCookie(characterId = '90000001', userId = 1): Promise<string> {
  const token = await encode({
    token: { characterId, userId },
    secret: env.AUTH_SECRET,
    salt: COOKIE_NAME,
  });
  return `${COOKIE_NAME}=${token}`;
}

function open(url: string, cookie?: string): Promise<WebSocket> {
  const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

/** Resolve with the first `mapUpdate` envelope, or reject after `ms`. */
function nextMapUpdate(ws: WebSocket, ms: number): Promise<ServerToClientMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no mapUpdate within ${ms}ms`)), ms);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerToClientMessage;
      if (msg.task === 'mapUpdate') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!run)('realtime transport (WS + bus)', () => {
  let server: Server;
  let baseUrl: string;
  let mapId: bigint;
  let deletedMapId: bigint;
  let cookie: string;
  let presenceUserId: number;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });

    const [m] = await db
      .insert(apMap)
      .values({ scope: 'wh', type: 'private', name: 'rt-test-map' })
      .returning({ id: apMap.id });
    mapId = m!.id;

    const [d] = await db
      .insert(apMap)
      .values({ scope: 'wh', type: 'private', name: 'rt-deleted-map', deletedAt: new Date() })
      .returning({ id: apMap.id });
    deletedMapId = d!.id;

    cookie = await sessionCookie();

    await db.delete(apCharacter).where(eq(apCharacter.id, PRESENCE_CHARACTER_ID));
    const [pu] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    presenceUserId = pu!.id;
    await db.insert(apCharacter).values({
      id: PRESENCE_CHARACTER_ID,
      userId: presenceUserId,
      name: 'Presence Test Pilot',
      ownerHash: `hash-${PRESENCE_CHARACTER_ID}`,
      authzLevel: 'member',
      status: 'active',
    });

    server = createServer();
    attachWsServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}${apertureConfig.WS_PATH}`;
  });

  afterAll(async () => {
    for (const ws of sockets) ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(apMap).where(sql`${apMap.id} in (${mapId}, ${deletedMapId})`);
    await db.delete(apCharacter).where(eq(apCharacter.id, PRESENCE_CHARACTER_ID));
    await db.delete(apUser).where(eq(apUser.id, presenceUserId));
    await pool.end();
  });

  it('fans a map event to two subscribed sockets within 500ms', async () => {
    const a = await open(baseUrl, cookie);
    const b = await open(baseUrl, cookie);
    sockets.push(a, b);

    a.send(JSON.stringify({ task: 'subscribe', load: { mapIds: [Number(mapId)] } }));
    b.send(JSON.stringify({ task: 'subscribe', load: { mapIds: [Number(mapId)] } }));
    await delay(200); // let LISTEN register before the insert

    const gotA = nextMapUpdate(a, 500);
    const gotB = nextMapUpdate(b, 500);

    await db.insert(apMapEvent).values({
      mapId,
      occurredAt: new Date(),
      kind: 'system.updated',
      payload: { kind: 'system.updated', hello: 1 },
    });

    const [ma, mb] = await Promise.all([gotA, gotB]);
    for (const m of [ma, mb]) {
      if (m.task !== 'mapUpdate') throw new Error(`expected mapUpdate, got ${m.task}`);
      expect(m.load.mapId).toBe(Number(mapId));
      expect(m.load.data).toMatchObject({ hello: 1 });
    }
  });

  it('rejects an upgrade with no session cookie', async () => {
    await expect(open(baseUrl)).rejects.toThrow(/401/);
  });

  it('does not deliver events for a soft-deleted map', async () => {
    const c = await open(baseUrl, cookie);
    sockets.push(c);
    c.send(JSON.stringify({ task: 'subscribe', load: { mapIds: [Number(deletedMapId)] } }));
    await delay(200);

    const got = nextMapUpdate(c, 400);
    await db.insert(apMapEvent).values({
      mapId: deletedMapId,
      occurredAt: new Date(),
      kind: 'map.update',
      payload: { kind: 'map.update' },
    });

    await expect(got).rejects.toThrow(/no mapUpdate/);
  });

  it('opens one presence session on connect, adopts it on reconnect, and advances ended_at on close', async () => {
    const presenceCookie = await sessionCookie(PRESENCE_CHARACTER_ID.toString(), presenceUserId);

    const a = await open(baseUrl, presenceCookie);
    sockets.push(a);
    await delay(200); // let the fire-and-forget openPresenceSession land

    const rowsAfterConnect = await db
      .select()
      .from(apCharacterPresence)
      .where(eq(apCharacterPresence.characterId, PRESENCE_CHARACTER_ID));
    expect(rowsAfterConnect).toHaveLength(1);
    const sessionId = rowsAfterConnect[0]!.id;
    const endedAtAfterConnect = rowsAfterConnect[0]!.endedAt.getTime();

    a.close();
    await delay(200); // let the close handler's touchPresenceSessions land

    const rowsAfterClose = await db
      .select()
      .from(apCharacterPresence)
      .where(eq(apCharacterPresence.characterId, PRESENCE_CHARACTER_ID));
    expect(rowsAfterClose).toHaveLength(1);
    expect(rowsAfterClose[0]!.id).toBe(sessionId);
    expect(rowsAfterClose[0]!.endedAt.getTime()).toBeGreaterThanOrEqual(endedAtAfterConnect);

    // Reconnecting well within PRESENCE_SESSION_GAP_MS adopts the same row
    // rather than opening a second one.
    const b = await open(baseUrl, presenceCookie);
    sockets.push(b);
    await delay(200);

    const rowsAfterReconnect = await db
      .select()
      .from(apCharacterPresence)
      .where(eq(apCharacterPresence.characterId, PRESENCE_CHARACTER_ID));
    expect(rowsAfterReconnect).toHaveLength(1);
    expect(rowsAfterReconnect[0]!.id).toBe(sessionId);
    expect(rowsAfterReconnect[0]!.endedAt.getTime()).toBeGreaterThan(rowsAfterClose[0]!.endedAt.getTime());
  });
});
