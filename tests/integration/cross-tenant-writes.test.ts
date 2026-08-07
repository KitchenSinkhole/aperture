// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
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
import { createSignature } from '@/lib/map/mutations/signatures';
import { createConnection } from '@/lib/map/mutations/connections';
import { pasteSignatures } from '@/lib/map/mutations/bulkSignatures';
import { addSystem } from '@/lib/map/mutations/systems';
import type { ResolvedSigRow } from '@/lib/map/signatureReader';

/**
 * Regression guard for the Stage 1 tenancy-binding asserts
 * (`assertSystemOnMap` / `assertConnectionOnMap`, `src/lib/map/mutations/tenancy.ts`).
 *
 * The actor-authorization gate (`requireMapMutate`) is present and correct on
 * every route — it proves the caller may act on the *named* map, nothing more.
 * A static grep of the route files therefore cannot detect this defect: the
 * gap is a missing second check, not a missing first one, and it lives inside
 * the mutation helpers, not the routes. The only reliable signal is a
 * behavioural attempt-and-reject against real Postgres — build two maps, try
 * to attach a child that lives on the other one, and confirm both the
 * rejection and that nothing was written.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test cross-tenant-writes
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98046001;
const CONSTELLATION = 98046001;
const SYSTEM_A1 = 98046002;
const SYSTEM_A2 = 98046003;
const SYSTEM_B1 = 98046004;
const CATEGORY = 98046001;
const GROUP = 98046001;
const TYPE_ID = 98046001;

let mapAId = 0n;
let mapBId = 0n;

describe.skipIf(!run)('cross-tenant create-path regression (real Postgres)', () => {
  let mapSystemA1 = 0n;
  let mapSystemA2 = 0n;
  let mapSystemB1 = 0n;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Cross-Tenant Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Cross-Tenant Test Const' });
    await db.insert(universeSystem).values([
      { id: SYSTEM_A1, constellationId: CONSTELLATION, name: 'J160001', security: 'C4' },
      { id: SYSTEM_A2, constellationId: CONSTELLATION, name: 'J160002', security: 'C4' },
      { id: SYSTEM_B1, constellationId: CONSTELLATION, name: 'J160003', security: 'C5' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Cross-Tenant Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Cross-Tenant Grp' });
    await db.insert(universeType).values({ id: TYPE_ID, groupId: GROUP, name: 'Cross-Tenant Type' });

    const [mA] = await db
      .insert(apMap)
      .values({ name: 'Cross-Tenant Map A', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapAId = mA!.id;
    const [mB] = await db
      .insert(apMap)
      .values({ name: 'Cross-Tenant Map B', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapBId = mB!.id;

    const resA1 = await addSystem({ mapId: mapAId, systemId: SYSTEM_A1, characterId: null });
    expect(resA1.ok).toBe(true);
    const resA2 = await addSystem({ mapId: mapAId, systemId: SYSTEM_A2, characterId: null });
    expect(resA2.ok).toBe(true);
    const resB1 = await addSystem({ mapId: mapBId, systemId: SYSTEM_B1, characterId: null });
    expect(resB1.ok).toBe(true);
    mapSystemA1 = BigInt((resA1 as { ok: true; data: { id: string } }).data.id);
    mapSystemA2 = BigInt((resA2 as { ok: true; data: { id: string } }).data.id);
    mapSystemB1 = BigInt((resB1 as { ok: true; data: { id: string } }).data.id);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  // ─── createSignature ──────────────────────────────────────────────────────

  it('createSignature rejects a mapSystemId that belongs to another map and writes nothing', async () => {
    const beforeEvents = await eventCount(mapAId);
    const beforeSigs = await sigCount(mapSystemB1);

    const result = await createSignature({
      mapId: mapAId,
      mapSystemId: mapSystemB1, // belongs to map B
      characterId: null,
      sigId: 'XTA-001',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(result.ok).toBe(false);
    expect(await eventCount(mapAId)).toBe(beforeEvents);
    expect(await sigCount(mapSystemB1)).toBe(beforeSigs);
  });

  it('createSignature succeeds when the mapSystemId belongs to the authorized map', async () => {
    const beforeEvents = await eventCount(mapAId);

    const result = await createSignature({
      mapId: mapAId,
      mapSystemId: mapSystemA1,
      characterId: null,
      sigId: 'XTA-002',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(result.ok).toBe(true);
    expect(await eventCount(mapAId)).toBe(beforeEvents + 1);
    expect(await sigCount(mapSystemA1)).toBeGreaterThan(0);
  });

  // ─── createConnection ─────────────────────────────────────────────────────

  it('createConnection rejects an endpoint that belongs to another map and writes nothing', async () => {
    const beforeEvents = await eventCount(mapAId);
    const beforeConns = await connCount(mapAId);

    const result = await createConnection({
      mapId: mapAId,
      characterId: null,
      sourceMapSystemId: mapSystemA1, // belongs to map A
      targetMapSystemId: mapSystemB1, // belongs to map B
      scope: 'wh',
    });

    expect(result.ok).toBe(false);
    expect(await eventCount(mapAId)).toBe(beforeEvents);
    expect(await connCount(mapAId)).toBe(beforeConns);
  });

  it('createConnection succeeds when both endpoints belong to the authorized map', async () => {
    const beforeEvents = await eventCount(mapAId);
    const beforeConns = await connCount(mapAId);

    const result = await createConnection({
      mapId: mapAId,
      characterId: null,
      sourceMapSystemId: mapSystemA1,
      targetMapSystemId: mapSystemA2,
      scope: 'wh',
    });

    expect(result.ok).toBe(true);
    expect(await eventCount(mapAId)).toBe(beforeEvents + 1);
    expect(await connCount(mapAId)).toBe(beforeConns + 1);
  });

  // ─── pasteSignatures (bulk-add branch) ────────────────────────────────────

  it('pasteSignatures add branch rejects a mapSystemId that belongs to another map and writes nothing', async () => {
    const beforeEvents = await eventCount(mapAId);
    const beforeSigs = await sigCount(mapSystemB1);

    const rows: ResolvedSigRow[] = [
      {
        sigId: 'XTB-001',
        name: null,
        groupName: null,
        signal: '100.0%',
        classKind: 'signature',
        groupKey: null,
        typeId: null,
      },
    ];

    const result = await pasteSignatures({
      mapId: mapAId,
      mapSystemId: mapSystemB1, // belongs to map B
      characterId: null,
      rows,
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: false,
        removeOrphanedConnections: false,
      },
      defaultExpiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(result.ok).toBe(false);
    expect(await eventCount(mapAId)).toBe(beforeEvents);
    expect(await sigCount(mapSystemB1)).toBe(beforeSigs);
  });

  it('pasteSignatures add branch succeeds when the mapSystemId belongs to the authorized map', async () => {
    const beforeEvents = await eventCount(mapAId);

    const rows: ResolvedSigRow[] = [
      {
        sigId: 'XTB-002',
        name: null,
        groupName: null,
        signal: '100.0%',
        classKind: 'signature',
        groupKey: null,
        typeId: null,
      },
    ];

    const result = await pasteSignatures({
      mapId: mapAId,
      mapSystemId: mapSystemA2,
      characterId: null,
      rows,
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: false,
        removeOrphanedConnections: false,
      },
      defaultExpiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toMatchObject({ added: 1 });
    expect(await eventCount(mapAId)).toBe(beforeEvents + 1);
    expect(await sigCount(mapSystemA2)).toBeGreaterThan(0);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function eventCount(mapId: bigint): Promise<number> {
  const rows = (
    await db.execute(sql`SELECT count(*)::int AS count FROM ap_map_event WHERE map_id = ${mapId}`)
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function sigCount(mapSystemId: bigint): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_map_signature WHERE map_system_id = ${mapSystemId}`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function connCount(mapId: bigint): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_map_connection WHERE map_id = ${mapId}`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function cleanup() {
  for (const id of [mapAId, mapBId]) {
    if (!id) continue;
    await db
      .delete(apMapSignature)
      .where(
        sql`${apMapSignature.mapSystemId} IN (SELECT id FROM ap_map_system WHERE map_id = ${id})`,
      );
    await db.delete(apMapConnection).where(eq(apMapConnection.mapId, id));
    await db.delete(apMapSystem).where(eq(apMapSystem.mapId, id));
    await db.delete(apMap).where(eq(apMap.id, id));
  }
  await db.delete(apMap).where(inArray(apMap.name, ['Cross-Tenant Map A', 'Cross-Tenant Map B']));
  await db.delete(universeType).where(eq(universeType.id, TYPE_ID));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db
    .delete(universeSystem)
    .where(inArray(universeSystem.id, [SYSTEM_A1, SYSTEM_A2, SYSTEM_B1]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
