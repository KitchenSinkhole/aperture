// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import { apMap, apMapEvent, apMapShare } from '@/db/schema';
import { resolveShareToken, revokeShareToken } from '@/lib/map/share';
import type { ServerToClientMessage } from '@/lib/realtime/protocol';

/**
 * Public map share — realtime (Stage 5 of docs/plans/public-map-share.md).
 *
 * A share token pins a public socket to one map at upgrade; the socket
 * receives only a data-free `publicUpdate` nudge on a real map event, ignores
 * every inbound frame, rejects a bad/expired/revoked token identically, caps
 * live sockets per token, and closes on revoke.
 * Gated behind RUN_DB_TESTS (needs containerized Postgres + applied migrations):
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test public-realtime
 */
const run = process.env.RUN_DB_TESTS === '1';

// Keep the per-token cap tiny so the cap test doesn't need hundreds of real
// sockets; every other test in this file opens at most two per token, well
// under it. `vi.mock` is hoisted above these imports, so `wsServer.ts` and
// `publicSockets.ts` resolve the overridden config too.
vi.mock('../../aperture.config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../aperture.config')>();
  return { apertureConfig: { ...actual.apertureConfig, PUBLIC_WS_MAX_PER_TOKEN: 2 } };
});

const { attachWsServer } = await import('@/lib/realtime/wsServer');
const { apertureConfig } = await import('../../aperture.config');

function openPublic(baseUrl: string, token: string | undefined): Promise<WebSocket> {
  const qs = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(`${baseUrl}${qs}`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

function nextMessage(ws: WebSocket, ms: number): Promise<ServerToClientMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no message within ${ms}ms`)), ms);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as ServerToClientMessage);
    });
  });
}

function neverMessage(ws: WebSocket, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      reject(new Error(`unexpected message: ${raw.toString()}`));
    });
  });
}

function nextClose(ws: WebSocket, ms: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no close within ${ms}ms`)), ms);
    ws.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!run)('public realtime (WS + bus)', () => {
  let server: Server;
  let baseUrl: string;
  let mapAId: bigint;
  let mapBId: bigint;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });

    const [a, b] = await db
      .insert(apMap)
      .values([
        { scope: 'wh', type: 'private', name: 'public-rt-map-a' },
        { scope: 'wh', type: 'private', name: 'public-rt-map-b' },
      ])
      .returning({ id: apMap.id });
    mapAId = a!.id;
    mapBId = b!.id;

    await db.insert(apMapShare).values([
      { mapId: mapAId, token: 'pub-rt-nudge', label: 'nudge' },
      { mapId: mapAId, token: 'pub-rt-fanout', label: 'fanout' },
      { mapId: mapAId, token: 'pub-rt-pin', label: 'pin' },
      { mapId: mapAId, token: 'pub-rt-cap', label: 'cap' },
      { mapId: mapAId, token: 'pub-rt-revoke', label: 'revoke' },
      {
        mapId: mapAId,
        token: 'pub-rt-expired',
        label: 'expired',
        expiresAt: new Date(Date.now() - 60_000),
      },
      { mapId: mapAId, token: 'pub-rt-revoked', label: 'pre-revoked', revokedAt: new Date() },
      { mapId: mapBId, token: 'pub-rt-map-b', label: 'map b' },
    ]);

    server = createServer();
    attachWsServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}${apertureConfig.WS_PUBLIC_PATH}`;
  });

  afterAll(async () => {
    for (const ws of sockets) ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(apMap).where(sql`${apMap.id} in (${mapAId}, ${mapBId})`);
    await pool.end();
  });

  it('nudges a public socket on a real map event, carrying only `ts`', async () => {
    const ws = await openPublic(baseUrl, 'pub-rt-nudge');
    sockets.push(ws);
    await delay(150); // let the bus LISTEN register before the insert

    const got = nextMessage(ws, 500);
    await db.insert(apMapEvent).values({
      mapId: mapAId,
      occurredAt: new Date(),
      kind: 'system.updated',
      payload: { kind: 'system.updated', hello: 1 },
    });

    const msg = await got;
    if (msg.task !== 'publicUpdate') throw new Error(`expected publicUpdate, got ${msg.task}`);
    expect(Object.keys(msg.load)).toEqual(['ts']);
    expect(typeof msg.load.ts).toBe('number');
  });

  it('nudges every public socket on the same token', async () => {
    const a = await openPublic(baseUrl, 'pub-rt-fanout');
    const b = await openPublic(baseUrl, 'pub-rt-fanout');
    sockets.push(a, b);
    await delay(150);

    const gotA = nextMessage(a, 500);
    const gotB = nextMessage(b, 500);
    await db.insert(apMapEvent).values({
      mapId: mapAId,
      occurredAt: new Date(),
      kind: 'system.updated',
      payload: { kind: 'system.updated', hello: 2 },
    });

    const [ma, mb] = await Promise.all([gotA, gotB]);
    expect(ma.task).toBe('publicUpdate');
    expect(mb.task).toBe('publicUpdate');
  });

  it('rejects a missing, garbage, expired, or revoked token identically', async () => {
    await expect(openPublic(baseUrl, undefined)).rejects.toThrow(/401/);
    await expect(openPublic(baseUrl, 'not-a-real-token')).rejects.toThrow(/401/);
    await expect(openPublic(baseUrl, 'pub-rt-expired')).rejects.toThrow(/401/);
    await expect(openPublic(baseUrl, 'pub-rt-revoked')).rejects.toThrow(/401/);
  });

  it('pins the socket to its token map and ignores inbound frames', async () => {
    const ws = await openPublic(baseUrl, 'pub-rt-pin');
    sockets.push(ws);
    await delay(150);

    // Public sockets are broadcast-only in both directions: this frame is a
    // no-op, not a channel switch (invariant 3).
    ws.send(JSON.stringify({ task: 'subscribe', load: { mapIds: [Number(mapBId)] } }));
    await delay(100);

    const nothingFromB = neverMessage(ws, 400);
    await db.insert(apMapEvent).values({
      mapId: mapBId,
      occurredAt: new Date(),
      kind: 'system.updated',
      payload: { kind: 'system.updated' },
    });
    await nothingFromB;

    const gotFromA = nextMessage(ws, 500);
    await db.insert(apMapEvent).values({
      mapId: mapAId,
      occurredAt: new Date(),
      kind: 'system.updated',
      payload: { kind: 'system.updated' },
    });
    expect((await gotFromA).task).toBe('publicUpdate');
  });

  it('rejects an upgrade past the per-token cap', async () => {
    const a = await openPublic(baseUrl, 'pub-rt-cap');
    const b = await openPublic(baseUrl, 'pub-rt-cap');
    sockets.push(a, b);

    // PUBLIC_WS_MAX_PER_TOKEN is mocked to 2 for this file.
    await expect(openPublic(baseUrl, 'pub-rt-cap')).rejects.toThrow(/503/);
  });

  it('closes every live socket for a token on revoke', async () => {
    const [share] = await db
      .select({ id: apMapShare.id })
      .from(apMapShare)
      .where(eq(apMapShare.token, 'pub-rt-revoke'));

    const ws = await openPublic(baseUrl, 'pub-rt-revoke');
    sockets.push(ws);
    await delay(150);

    const closed = nextClose(ws, 500);
    const token = await revokeShareToken(share!.id);
    expect(token).toBe('pub-rt-revoke');
    expect(await closed).toBe(4001);

    expect(await resolveShareToken('pub-rt-revoke')).toBeNull();
    // Idempotent: revoking an already-revoked share closes nothing new.
    expect(await revokeShareToken(share!.id)).toBeNull();
  });
});
