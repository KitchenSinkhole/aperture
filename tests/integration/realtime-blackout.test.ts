// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { encode } from 'next-auth/jwt';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apAccessGrant, apCharacter, apInstance, apMap, apMapShare, apUser } from '@/db/schema';
import { env } from '@/lib/env';
import { apertureConfig } from '../../aperture.config';
import { attachWsServer } from '@/lib/realtime/wsServer';
import type { BlackoutStatus, ServerToClientMessage } from '@/lib/realtime/protocol';

/**
 * Blackout over the real WS + bus: an instance notify answers every session
 * socket with an immediate `healthCheck` carrying that socket's re-resolved
 * standing, and the session forward drops other accounts' presence while the
 * socket isn't cleared. A flip of the switch nudges every public socket whose
 * share publishes presence.
 *
 * `ap_instance` is a live singleton, so the switch is snapshotted in `beforeAll`
 * and restored in `afterAll`. Ids use a 9723xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test realtime-blackout
 */
const run = process.env.RUN_DB_TESTS === '1';
const COOKIE_NAME = 'authjs.session-token';

const MEMBER_CHAR = 97230001n;
const OTHER_CHAR = 97230002n;
const characterIds = [MEMBER_CHAR, OTHER_CHAR];

async function sessionCookie(characterId: bigint, userId: number): Promise<string> {
  const token = await encode({
    token: { characterId: characterId.toString(), userId },
    secret: env.AUTH_SECRET,
    salt: COOKIE_NAME,
  });
  return `${COOKIE_NAME}=${token}`;
}

/** A socket plus every frame it has received, collected from the moment it is created. */
type Probe = { ws: WebSocket; frames: ServerToClientMessage[] };

function open(url: string, cookie?: string): Promise<Probe> {
  const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : {});
  const probe: Probe = { ws, frames: [] };
  ws.on('message', (raw) => probe.frames.push(JSON.parse(raw.toString()) as ServerToClientMessage));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(probe));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

/** Resolve with the first frame (already received or arriving within `ms`) that matches. */
async function waitFor(
  probe: Probe,
  match: (m: ServerToClientMessage) => boolean,
  ms: number,
): Promise<ServerToClientMessage> {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = probe.frames.find(match);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`no matching frame within ${ms}ms`);
    await delay(20);
  }
}

function blackoutOf(m: ServerToClientMessage): BlackoutStatus | undefined {
  return m.task === 'healthCheck' ? m.load.blackout : undefined;
}

function healthCheckWith(expected: Partial<BlackoutStatus>) {
  return (m: ServerToClientMessage) => {
    const b = blackoutOf(m);
    return b !== undefined && Object.entries(expected).every(([k, v]) => b[k as keyof BlackoutStatus] === v);
  };
}

function isCharacterUpdateFor(characterId: bigint) {
  return (m: ServerToClientMessage) =>
    m.task === 'characterUpdate' && m.load.characterId === Number(characterId);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function notifyInstance(): Promise<void> {
  await db.execute(sql`SELECT pg_notify(${apertureConfig.INSTANCE_NOTIFY_CHANNEL}, '')`);
}

async function setSwitch(since: Date | null): Promise<void> {
  await db
    .update(apInstance)
    .set({ blackoutSince: since, blackoutByCharacterId: null })
    .where(eq(apInstance.id, 1));
}

let instanceSnapshot: typeof apInstance.$inferSelect | undefined;

describe.skipIf(!run)('Blackout over realtime (WS + bus)', () => {
  let server: Server;
  let baseUrl: string;
  let mapId: bigint;
  let memberUserId: number;
  let otherUserId: number;
  let publicBaseUrl: string;
  let member: Probe;
  let other: Probe;
  let spectatorFull: Probe;
  let spectatorNone: Probe;

  async function broadcastPresence(characterId: bigint, userId: number): Promise<void> {
    const envelope = JSON.stringify({
      task: 'characterUpdate',
      load: {
        characterId: Number(characterId),
        characterName: `Blackout Pilot ${characterId}`,
        userId,
        mainCharacterId: null,
        mainCharacterName: null,
        online: true,
        systemId: null,
        systemName: null,
        systemSecurity: null,
        systemTrueSec: null,
        shipTypeId: null,
        shipTypeName: null,
        shipClass: null,
        shipName: null,
        locationAt: new Date().toISOString(),
      },
    });
    const channel = `${apertureConfig.MAP_EVENT_NOTIFY_CHANNEL_PREFIX}${mapId}`;
    await db.execute(sql`SELECT pg_notify(${channel}, ${envelope})`);
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();
    await setSwitch(null);

    const [mu, ou] = await db.insert(apUser).values([{}, {}]).returning({ id: apUser.id });
    memberUserId = mu!.id;
    otherUserId = ou!.id;
    await db.insert(apCharacter).values([
      {
        id: MEMBER_CHAR,
        userId: memberUserId,
        name: 'Blackout Member',
        ownerHash: `hash-${MEMBER_CHAR}`,
        authzLevel: 'member',
        status: 'active',
      },
      {
        id: OTHER_CHAR,
        userId: otherUserId,
        name: 'Blackout Other',
        ownerHash: `hash-${OTHER_CHAR}`,
        authzLevel: 'member',
        status: 'active',
      },
    ]);

    const [m] = await db
      .insert(apMap)
      .values({ scope: 'wh', type: 'private', name: 'rt-blackout-map', ownerCharacterId: MEMBER_CHAR })
      .returning({ id: apMap.id });
    mapId = m!.id;
    await db.insert(apMapShare).values([
      { mapId, token: 'rt-blackout-full', label: 'full', presenceMode: 'full' },
      { mapId, token: 'rt-blackout-none', label: 'none', presenceMode: 'none' },
    ]);

    server = createServer();
    attachWsServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `ws://127.0.0.1:${port}${apertureConfig.WS_PATH}`;
    publicBaseUrl = `ws://127.0.0.1:${port}${apertureConfig.WS_PUBLIC_PATH}?token=`;
  });

  afterAll(async () => {
    member?.ws.close();
    other?.ws.close();
    spectatorFull?.ws.close();
    spectatorNone?.ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(apMap).where(eq(apMap.id, mapId));
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
    await pool.end();
  });

  it('sends the connect healthCheck with the socket standing while off', async () => {
    member = await open(baseUrl, await sessionCookie(MEMBER_CHAR, memberUserId));
    other = await open(baseUrl, await sessionCookie(OTHER_CHAR, otherUserId));
    spectatorFull = await open(`${publicBaseUrl}rt-blackout-full`);
    spectatorNone = await open(`${publicBaseUrl}rt-blackout-none`);
    const first = await waitFor(member, (m) => m.task === 'healthCheck', 1000);
    expect(blackoutOf(first)).toEqual({ active: false, since: null, cleared: false });
  });

  it('answers an instance notify with an immediate healthCheck to every session socket', async () => {
    const since = new Date();
    await setSwitch(since);
    await notifyInstance();

    for (const probe of [member, other]) {
      const hc = await waitFor(probe, healthCheckWith({ active: true }), 1000);
      expect(blackoutOf(hc)).toEqual({ active: true, since: since.toISOString(), cleared: false });
    }
  });

  it('nudges a presence-publishing public socket when Blackout turns on, and no other', async () => {
    const nudge = await waitFor(spectatorFull, (m) => m.task === 'publicUpdate', 1000);
    expect(Object.keys(nudge.load)).toEqual(['ts']);
    expect(spectatorNone.frames).toEqual([]);
  });

  it("drops another account's presence to a socket that isn't cleared, and keeps its own", async () => {
    member.ws.send(JSON.stringify({ task: 'subscribe', load: { mapIds: [Number(mapId)] } }));
    await delay(200); // let the subscribe's view check and LISTEN land

    member.frames.length = 0;
    await broadcastPresence(OTHER_CHAR, otherUserId);
    await broadcastPresence(MEMBER_CHAR, memberUserId);

    await waitFor(member, isCharacterUpdateFor(MEMBER_CHAR), 1000);
    expect(member.frames.some(isCharacterUpdateFor(OTHER_CHAR))).toBe(false);
  });

  it('re-resolves each socket on a list edit, and the forward follows', async () => {
    member.frames.length = 0;
    other.frames.length = 0;
    await db.insert(apAccessGrant).values({
      principalKind: 'character',
      principalId: MEMBER_CHAR,
      scope: 'instance',
      mapId: null,
      capability: 'blackout_view',
    });
    await notifyInstance();

    const memberHc = await waitFor(member, (m) => m.task === 'healthCheck', 1000);
    const otherHc = await waitFor(other, (m) => m.task === 'healthCheck', 1000);
    expect(blackoutOf(memberHc)).toMatchObject({ active: true, cleared: true });
    expect(blackoutOf(otherHc)).toMatchObject({ active: true, cleared: false });

    await broadcastPresence(OTHER_CHAR, otherUserId);
    await waitFor(member, isCharacterUpdateFor(OTHER_CHAR), 1000);
  });

  it('reports off to everyone once Blackout lifts', async () => {
    spectatorFull.frames.length = 0;
    await setSwitch(null);
    await notifyInstance();

    const hc = await waitFor(other, healthCheckWith({ active: false }), 1000);
    expect(blackoutOf(hc)).toEqual({ active: false, since: null, cleared: false });
  });

  it('nudges the presence-publishing public socket again when Blackout lifts', async () => {
    // Inside the per-socket nudge interval of the earlier nudge, so this one may trail.
    await waitFor(spectatorFull, (m) => m.task === 'publicUpdate', 2000);
    expect(spectatorFull.frames.filter((m) => m.task === 'publicUpdate')).toHaveLength(1);
    expect(spectatorNone.frames).toEqual([]);
  });
});

async function cleanup(): Promise<void> {
  await db.delete(apMapShare).where(inArray(apMapShare.token, ['rt-blackout-full', 'rt-blackout-none']));
  await db
    .delete(apAccessGrant)
    .where(
      and(eq(apAccessGrant.principalKind, 'character'), inArray(apAccessGrant.principalId, characterIds)),
    );
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, characterIds));
  await db.delete(apCharacter).where(inArray(apCharacter.id, characterIds));
  const userIds = users.map((u) => u.userId);
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
}
