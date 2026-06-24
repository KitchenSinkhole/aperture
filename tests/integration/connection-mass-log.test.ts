// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapSystem,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeSystem,
  universeType,
} from '@/db/schema';
import { addSystem } from '@/lib/map/mutations/systems';
import { createConnection, deleteConnection } from '@/lib/map/mutations/connections';
import { foldWormholeJumpOntoMap } from '@/lib/jobs/locationCommit';
import { listConnectionMassLog, logConnectionJump } from '@/lib/map/connectionMassLog';
import { shipMass } from '@/lib/eve/shipMass';

/**
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * Covers the server-derived connection mass-log: base `universe_type.mass`
 * resolution, the
 * per-jump writer's cumulative sum, the null-mass skip, the fold returning a
 * connection id for both created and pre-existing connections, the
 * `addNewSystems=false` presence gate (suppress new systems, fold between
 * already-visible ones), and the ON DELETE CASCADE when a connection is
 * hard-deleted.
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98031001;
const CONSTELLATION = 98031001;
const C3 = 98031003;
const HS = 98031004;
const CATEGORY = 98031001;
const GROUP = 98031001;
const SHIP = 98031020; // a ship type with a seeded base `mass`
const SHIP_NO_MASS = 98031021; // a type with a null `mass` → shipMass null
const SHIP_MASS_KG = 1_000_000;

let mapId = 0n;
let foldMapId = 0n;
let connId = 0n;

describe.skipIf(!run)('connection mass-log (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Mass Log Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Mass Log Const' });
    await db.insert(universeSystem).values([
      { id: C3, constellationId: CONSTELLATION, name: 'J131003', security: 'C3' },
      { id: HS, constellationId: CONSTELLATION, name: 'Mass HS', security: 'H' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Mass Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Mass Grp' });
    await db.insert(universeType).values([
      { id: SHIP, groupId: GROUP, name: 'Mass Test Ship', mass: SHIP_MASS_KG },
      { id: SHIP_NO_MASS, groupId: GROUP, name: 'Massless Ship' },
    ]);

    const [map] = await db
      .insert(apMap)
      .values({ name: 'Mass Log Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapId = map!.id;
    const [foldMap] = await db
      .insert(apMap)
      .values({ name: 'Mass Log Fold Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    foldMapId = foldMap!.id;

    // A shared connection for the cumulative / skip / cascade tests.
    await addSystem({ mapId, systemId: C3, characterId: null });
    await addSystem({ mapId, systemId: HS, characterId: null });
    const created = await createConnection({
      mapId,
      characterId: null,
      sourceMapSystemId: await mapSystemId(mapId, C3),
      targetMapSystemId: await mapSystemId(mapId, HS),
      scope: 'wh',
    });
    if (!created.ok) throw new Error('failed to seed connection');
    connId = BigInt((created.data as { id: string }).id);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('shipMass resolves the seeded base `mass`, null for an unmassed type', async () => {
    expect(await shipMass(SHIP)).toBe(SHIP_MASS_KG);
    expect(await shipMass(SHIP_NO_MASS)).toBeNull();
  });

  it('logConnectionJump records jumps with a correct running cumulative', async () => {
    await logConnectionJump({ mapId, connectionId: connId, characterId: null, shipTypeId: SHIP, mass: 1_000_000 });
    await logConnectionJump({ mapId, connectionId: connId, characterId: null, shipTypeId: SHIP, mass: 2_000_000 });
    await logConnectionJump({ mapId, connectionId: connId, characterId: null, shipTypeId: null, mass: 500_000 });

    // Newest jump first; cumulative is the chronological running total, so the
    // first (latest) entry carries the grand total.
    const entries = await listConnectionMassLog({ mapId, connectionId: connId });
    expect(entries.map((e) => e.mass)).toEqual([500_000, 2_000_000, 1_000_000]);
    expect(entries.map((e) => e.cumulativeMass)).toEqual([3_500_000, 3_000_000, 1_000_000]);
  });

  it('logConnectionJump skips a null mass (no row, cumulative unchanged)', async () => {
    const before = await logCount(connId);
    await logConnectionJump({ mapId, connectionId: connId, characterId: null, shipTypeId: SHIP_NO_MASS, mass: null });
    expect(await logCount(connId)).toBe(before);
  });

  it('listConnectionMassLog is scoped to the map (foreign map id returns empty)', async () => {
    expect(await listConnectionMassLog({ mapId: foldMapId, connectionId: connId })).toEqual([]);
  });

  it('foldWormholeJumpOntoMap returns a connection id for created then pre-existing', async () => {
    const first = await foldWormholeJumpOntoMap({
      mapId: foldMapId,
      characterId: null as unknown as bigint, // fold accepts a bigint; null is fine for the audit FK
      fromSystemId: C3,
      toSystemId: HS,
      addNewSystems: true,
    });
    expect(first.connectionCreated).toBe(true);
    expect(first.connectionId).toBeGreaterThan(0n);

    const second = await foldWormholeJumpOntoMap({
      mapId: foldMapId,
      characterId: null as unknown as bigint,
      fromSystemId: C3,
      toSystemId: HS,
      addNewSystems: true,
    });
    expect(second.connectionCreated).toBe(false);
    expect(second.connectionId).toBe(first.connectionId);

    // The same connection logs a re-jump.
    await logConnectionJump({ mapId: foldMapId, connectionId: second.connectionId!, characterId: null, shipTypeId: SHIP, mass: 1_000_000 });
    expect(await logCount(second.connectionId!)).toBe(1);
  });

  it('addNewSystems=false suppresses a jump with an off-map endpoint, folds between visible ones', async () => {
    const [gateMap] = await db
      .insert(apMap)
      .values({ name: 'Mass Log Gate Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    const gateMapId = gateMap!.id;

    // Pilot has the map closed and neither endpoint is on it → nothing is added,
    // no connection to log against.
    const suppressed = await foldWormholeJumpOntoMap({
      mapId: gateMapId,
      characterId: null as unknown as bigint,
      fromSystemId: C3,
      toSystemId: HS,
      addNewSystems: false,
    });
    expect(suppressed.connectionId).toBeNull();
    expect(suppressed.fromSystemAdded).toBe(false);
    expect(suppressed.toSystemAdded).toBe(false);
    const placedAfterSuppressed = await db
      .select({ id: apMapSystem.id })
      .from(apMapSystem)
      .where(eq(apMapSystem.mapId, gateMapId));
    expect(placedAfterSuppressed).toHaveLength(0);

    // Both endpoints already on the map → the closed-Aperture jump still records
    // the connection between them (movement among already-added systems).
    await addSystem({ mapId: gateMapId, systemId: C3, characterId: null });
    await addSystem({ mapId: gateMapId, systemId: HS, characterId: null });
    const recorded = await foldWormholeJumpOntoMap({
      mapId: gateMapId,
      characterId: null as unknown as bigint,
      fromSystemId: C3,
      toSystemId: HS,
      addNewSystems: false,
    });
    expect(recorded.connectionId).not.toBeNull();
    expect(recorded.connectionCreated).toBe(true);
    expect(recorded.fromSystemAdded).toBe(false);
    expect(recorded.toSystemAdded).toBe(false);
  });

  it('deleting a connection cascades its mass-log rows away', async () => {
    expect(await logCount(connId)).toBeGreaterThan(0);
    const deleted = await deleteConnection({ mapId, connectionId: connId, characterId: null });
    expect(deleted.ok).toBe(true);
    expect(await logCount(connId)).toBe(0);
  });
});

async function logCount(connectionId: bigint): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_map_connection_log WHERE connection_id = ${connectionId}`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function mapSystemId(map: bigint, systemId: number): Promise<bigint> {
  const [row] = await db
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, map), eq(apMapSystem.systemId, systemId)));
  return row!.id;
}

async function cleanup() {
  if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
  if (foldMapId) await db.delete(apMap).where(eq(apMap.id, foldMapId));
  await db.delete(apMap).where(inArray(apMap.name, ['Mass Log Map', 'Mass Log Fold Map', 'Mass Log Gate Map']));
  await db.delete(universeType).where(inArray(universeType.id, [SHIP, SHIP_NO_MASS]));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [C3, HS]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
