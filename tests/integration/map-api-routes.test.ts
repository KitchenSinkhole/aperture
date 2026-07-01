// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapSignature,
  apMapSystem,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeSystem,
  universeType,
} from '@/db/schema';
import { env } from '@/lib/env';
import {
  createSignature,
  deleteSignature,
  updateSignature,
} from '@/lib/map/mutations/signatures';
import { addSystem, removeSystem } from '@/lib/map/mutations/systems';
import { createConnection } from '@/lib/map/mutations/connections';
import { guardMap, parseBigInt } from '@/app/api/map/utils';
import { mapEventPayloadSchema } from '@/lib/realtime/protocol';

/**
 * Signature CRUD helpers + broadcast-fire confirmation.
 * Also validates the `guardMap` and `parseBigInt` helpers used by every route.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98040001;
const CONSTELLATION = 98040001;
const SYSTEM_A = 98040002;
const SYSTEM_B = 98040003;
const CATEGORY = 98040001;
const GROUP = 98040001;
const TYPE_ID = 98040001;

let mapId = 0n;

describe.skipIf(!run)('map API routes — signature mutations + broadcast (real Postgres)', () => {
  let listener: Client;
  let mapSystemIdA = 0n;
  let mapSystemIdB = 0n;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'API Route Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'API Route Test Const' });
    await db.insert(universeSystem).values([
      { id: SYSTEM_A, constellationId: CONSTELLATION, name: 'J140001', security: 'C4' },
      { id: SYSTEM_B, constellationId: CONSTELLATION, name: 'J140002', security: 'C5' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'API Route Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'API Route Grp' });
    await db.insert(universeType).values({ id: TYPE_ID, groupId: GROUP, name: 'Test WH Type' });

    const [m] = await db
      .insert(apMap)
      .values({ name: 'API Route Test Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapId = m!.id;

    // Add two map systems to use in tests.
    const resA = await addSystem({ mapId, systemId: SYSTEM_A, characterId: null });
    expect(resA.ok).toBe(true);
    const resB = await addSystem({ mapId, systemId: SYSTEM_B, characterId: null });
    expect(resB.ok).toBe(true);
    mapSystemIdA = BigInt((resA as { ok: true; data: { id: string } }).data.id);
    mapSystemIdB = BigInt((resB as { ok: true; data: { id: string } }).data.id);

    // Set up a LISTEN client for broadcast tests.
    listener = new Client({ connectionString: env.DATABASE_URL });
    await listener.connect();
    await listener.query(`LISTEN "map:${mapId}"`);
  });

  afterAll(async () => {
    await listener?.end();
    await cleanup();
    await pool.end();
  });

  // ─── parseBigInt / guardMap ────────────────────────────────────────────────

  it('parseBigInt handles valid and invalid inputs', () => {
    expect(parseBigInt('123')).toBe(123n);
    expect(parseBigInt('0')).toBe(0n);
    expect(parseBigInt('abc')).toBeNull();
    expect(parseBigInt('')).toBeNull();
    expect(parseBigInt('1.5')).toBeNull();
    expect(parseBigInt('-1')).toBeNull();
  });

  it('guardMap returns mapId for a live map, null for a deleted or unknown map', async () => {
    const ok = await guardMap(mapId.toString());
    expect(ok).toEqual({ mapId });

    expect(await guardMap('999999999')).toBeNull();
    expect(await guardMap('abc')).toBeNull();

    // Soft-deleted map.
    const [del] = await db
      .insert(apMap)
      .values({ name: 'Deleted Map', scope: 'wh', type: 'private', deletedAt: new Date() })
      .returning({ id: apMap.id });
    expect(await guardMap(del!.id.toString())).toBeNull();
    await db.delete(apMap).where(eq(apMap.id, del!.id));
  });

  // ─── createSignature ──────────────────────────────────────────────────────

  it('createSignature inserts a row and emits one signature.create event', async () => {
    const before = await eventCount();
    const expires = new Date(Date.now() + 86_400_000);

    const result = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'ABC',
      groupKey: 'wormhole',
      typeId: TYPE_ID,
      name: 'Test Sig',
      expiresAt: expires,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => mapEventPayloadSchema.parse(result.data)).not.toThrow();
    expect(result.data).toMatchObject({
      kind: 'signature.create',
      sigId: 'ABC',
      groupKey: 'wormhole',
      typeId: TYPE_ID,
      name: 'Test Sig',
      mapSystemId: mapSystemIdA.toString(),
    });
    expect(await eventCount()).toBe(before + 1);

    const [row] = await db
      .select({ sigId: apMapSignature.sigId, name: apMapSignature.name })
      .from(apMapSignature)
      .where(eq(apMapSignature.id, BigInt((result.data as { id: string }).id)));
    expect(row).toMatchObject({ sigId: 'ABC', name: 'Test Sig' });
  });

  // ─── updateSignature ─────────────────────────────────────────────────────

  it('updateSignature patches only given fields and emits one signature.update event', async () => {
    const [sig] = await db
      .select({ id: apMapSignature.id })
      .from(apMapSignature)
      .where(
        and(eq(apMapSignature.mapSystemId, mapSystemIdA), eq(apMapSignature.sigId, 'ABC')),
      );
    const signatureId = sig!.id;

    const before = await eventCount();
    const result = await updateSignature({
      mapId,
      signatureId,
      characterId: null,
      patch: { name: 'Renamed Sig', description: 'gas site' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      kind: 'signature.update',
      eventId: result.eventId,
      id: signatureId.toString(),
      name: 'Renamed Sig',
      description: 'gas site',
      updatedAt: expect.any(String),
      // Audit descriptors ride every update: owning system + the (here unchanged) code.
      mapSystemId: mapSystemIdA.toString(),
      sigId: 'ABC',
      // Full post-update snapshot (self-heal); carries the paste-derived classKind.
      snapshot: {
        id: signatureId.toString(),
        mapSystemId: mapSystemIdA.toString(),
        mapConnectionId: null,
        sigId: 'ABC',
        groupKey: 'wormhole',
        classKind: null,
        typeId: expect.any(Number),
        wormholeCode: null,
        name: 'Renamed Sig',
        description: 'gas site',
        expiresAt: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        leadsToMapSystemId: null,
      },
    });
    expect(await eventCount()).toBe(before + 1);

    const [row] = await db
      .select({ name: apMapSignature.name, description: apMapSignature.description })
      .from(apMapSignature)
      .where(eq(apMapSignature.id, signatureId));
    expect(row).toMatchObject({ name: 'Renamed Sig', description: 'gas site' });
  });

  it('updateSignature rejects a signature that belongs to a different map', async () => {
    const [sig] = await db
      .select({ id: apMapSignature.id })
      .from(apMapSignature)
      .where(
        and(eq(apMapSignature.mapSystemId, mapSystemIdA), eq(apMapSignature.sigId, 'ABC')),
      );

    // Create a second map with no systems — any sigId will "not belong" to it.
    const [otherMap] = await db
      .insert(apMap)
      .values({ name: 'Other Map', scope: 'wh', type: 'private' })
      .returning({ id: apMap.id });

    const result = await updateSignature({
      mapId: otherMap!.id,
      signatureId: sig!.id,
      characterId: null,
      patch: { name: 'Should Fail' },
    });
    expect(result.ok).toBe(false);
    await db.delete(apMap).where(eq(apMap.id, otherMap!.id));
  });

  // ─── deleteSignature ─────────────────────────────────────────────────────

  it('deleteSignature hard-deletes the row and emits one signature.delete event', async () => {
    const [sig] = await db
      .select({ id: apMapSignature.id })
      .from(apMapSignature)
      .where(
        and(eq(apMapSignature.mapSystemId, mapSystemIdA), eq(apMapSignature.sigId, 'ABC')),
      );
    const signatureId = sig!.id;

    const before = await eventCount();
    const result = await deleteSignature({ mapId, signatureId, characterId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      kind: 'signature.delete',
      eventId: result.eventId,
      id: signatureId.toString(),
      mapSystemId: mapSystemIdA.toString(),
      sigId: 'ABC',
    });
    expect(await eventCount()).toBe(before + 1);

    const remaining = await db
      .select({ id: apMapSignature.id })
      .from(apMapSignature)
      .where(eq(apMapSignature.id, signatureId));
    expect(remaining).toHaveLength(0);
  });

  // ─── LISTEN broadcast ────────────────────────────────────────────────────

  it('createSignature broadcast fires on map:<mapId> within 2s', async () => {
    const received = listenOnce(listener, 2000);
    const expires = new Date(Date.now() + 86_400_000);

    const result = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'XYZ',
      expiresAt: expires,
    });
    expect(result.ok).toBe(true);

    const note = await received;
    expect(note.channel).toBe(`map:${mapId}`);
    const payload = JSON.parse(note.payload);
    expect(payload).toMatchObject({ kind: 'signature.create', sigId: 'XYZ' });
  });

  it('connection mutations broadcast fires on map:<mapId> within 2s', async () => {
    // Also confirm the connection helpers (exercised in 9.2 but LISTEN-tested here).
    const received = listenOnce(listener, 2000);

    const result = await createConnection({
      mapId,
      characterId: null,
      sourceMapSystemId: mapSystemIdA,
      targetMapSystemId: mapSystemIdB,
      scope: 'wh',
    });
    expect(result.ok).toBe(true);

    const note = await received;
    expect(note.channel).toBe(`map:${mapId}`);
    const payload = JSON.parse(note.payload);
    expect(payload).toMatchObject({ kind: 'connection.create', scope: 'wh' });
  });

  it('system mutation (removeSystem) broadcast fires on map:<mapId> within 2s', async () => {
    const received = listenOnce(listener, 2000);

    const result = await removeSystem({ mapId, mapSystemId: mapSystemIdB, characterId: null });
    expect(result.ok).toBe(true);

    const note = await received;
    expect(note.channel).toBe(`map:${mapId}`);
    const payload = JSON.parse(note.payload);
    expect(payload).toMatchObject({ kind: 'system.removed' });
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function eventCount(): Promise<number> {
  const rows = (
    await db.execute(sql`SELECT count(*)::int AS count FROM ap_map_event WHERE map_id = ${mapId}`)
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

function listenOnce(
  client: Client,
  timeoutMs: number,
): Promise<{ channel: string; payload: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no notification within ${timeoutMs}ms`)), timeoutMs);
    client.once('notification', (msg) => {
      clearTimeout(timer);
      resolve({ channel: msg.channel, payload: msg.payload ?? '' });
    });
  });
}

async function cleanup() {
  if (mapId) {
    await db
      .delete(apMapSignature)
      .where(
        sql`${apMapSignature.mapSystemId} IN (
          SELECT id FROM ap_map_system WHERE map_id = ${mapId}
        )`,
      );
    await db.delete(apMapConnection).where(eq(apMapConnection.mapId, mapId));
    await db.delete(apMapSystem).where(eq(apMapSystem.mapId, mapId));
    await db.delete(apMap).where(eq(apMap.id, mapId));
  }
  await db.delete(apMap).where(eq(apMap.name, 'API Route Test Map'));
  await db.delete(universeType).where(eq(universeType.id, TYPE_ID));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYSTEM_A, SYSTEM_B]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
