// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apMap,
  apUser,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeStargateEdge,
  universeSystem,
  universeSystemStatic,
  universeType,
  universeWormhole,
} from '@/db/schema';
import { apertureConfig } from '../../aperture.config';
import { loadMapForView } from '@/lib/map/loadMap';
import { jumpsToHubs, routesForSystems } from '@/lib/map/route';

const REGION = 98020001;
const CONSTELLATION = 98020001;
const K1 = 98020001; // gates to a hub
const K2 = 98020002; // gates to K1 (2 jumps from hub)
const WH = 98020003; // wormhole, no gates
const CATEGORY = 98020001;
const GROUP = 98020001;
const WH_TYPE = 98020001;
const HUB = apertureConfig.ROUTE_HUBS[0]!.systemId; // Jita

let mapId = 0n;
let hubInserted = false;
// Read paths require a viewer character. Provision a synthetic
// admin so the test exercises the same path as a real `/maps` request.
const TEST_VIEWER_ID = 98020999n;
let testUserId = 0;

describe('read-only map view (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'View Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'View Test Const' });
    await db.insert(universeSystem).values([
      { id: K1, constellationId: CONSTELLATION, name: 'Vtest K1', security: '0.5' },
      { id: K2, constellationId: CONSTELLATION, name: 'Vtest K2', security: '0.5' },
      { id: WH, constellationId: CONSTELLATION, name: 'J199999', security: 'C3' },
    ]);

    // The hub (Jita) may already exist if the SDE was ingested; only insert if
    // missing, and only remove it again in cleanup if we created it.
    const [existingHub] = await db
      .select({ id: universeSystem.id })
      .from(universeSystem)
      .where(eq(universeSystem.id, HUB));
    if (!existingHub) {
      await db
        .insert(universeSystem)
        .values({ id: HUB, constellationId: CONSTELLATION, name: 'Vtest Hub', security: '0.9' });
      hubInserted = true;
    }

    // Gate graph: HUB — K1 — K2 (so K2 is 2 jumps from the hub). Our custom edge
    // guarantees the path regardless of any real SDE edges on the hub.
    await db.insert(universeStargateEdge).values([
      { fromSystemId: HUB, toSystemId: K1 },
      { fromSystemId: K1, toSystemId: K2 },
    ]);

    // Wormhole static catalog for WH.
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Vtest Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Vtest Grp' });
    await db
      .insert(universeType)
      .values({ id: WH_TYPE, groupId: GROUP, name: 'Wormhole XYZ' });
    await db
      .insert(universeWormhole)
      .values({ typeId: WH_TYPE, name: 'XYZ', sourceClasses: ['C3'], targetClass: null });
    await db.insert(universeSystemStatic).values({ systemId: WH, typeId: WH_TYPE });

    // Synthetic viewer with admin authz so `loadMapForView` passes the rights
    // gate. Reuses the existing user row if a previous failed run left it.
    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    testUserId = u!.id;
    await db.insert(apCharacter).values({
      id: TEST_VIEWER_ID,
      userId: testUserId,
      name: 'View Test Viewer',
      ownerHash: 'view-test-hash',
      authzLevel: 'admin',
    });

    // The map: K2 (k-space) connected by a fresh wormhole to WH (j-space).
    const [map] = await db
      .insert(apMap)
      .values({
        name: 'View Test Map',
        scope: 'all',
        type: 'private',
        ownerCharacterId: TEST_VIEWER_ID,
      })
      .returning({ id: apMap.id });
    mapId = map!.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('loads the map with visible systems flattened + statics', async () => {
    // Add systems + a connection through the schema directly (no mutation API yet).
    const { apMapSystem, apMapConnection } = await import('@/db/schema');
    const rows = await db
      .insert(apMapSystem)
      .values([
        { mapId, systemId: K2, visible: true, positionX: 10, positionY: 20, status: 'occupied', alias: 'Hub2', tag: 'X' },
        { mapId, systemId: WH, visible: true, positionX: 100, positionY: 200, status: 'hostile' },
        { mapId, systemId: K1, visible: false, positionX: 0, positionY: 0, status: 'unknown' },
      ])
      .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });
    const k2Row = rows.find((r) => r.systemId === K2)!;
    const whRow = rows.find((r) => r.systemId === WH)!;
    await db.insert(apMapConnection).values({
      mapId,
      sourceMapSystemId: k2Row.id,
      targetMapSystemId: whRow.id,
      scope: 'wh',
      massStatus: 'fresh',
      // `createConnection` stamps this; a direct insert must too, or
      // `loadMapForView`'s `confirmed_at IS NOT NULL` filter hides the edge.
      confirmedAt: new Date(),
    });

    const data = await loadMapForView(mapId, TEST_VIEWER_ID);
    expect(data).not.toBeNull();
    expect(data!.systems).toHaveLength(2); // invisible K1 excluded
    const wh = data!.systems.find((s) => s.systemId === WH)!;
    expect(wh.name).toBe('J199999');
    expect(wh.statics).toEqual(['XYZ']);
    const k2 = data!.systems.find((s) => s.systemId === K2)!;
    expect(k2.alias).toBe('Hub2');
    expect(k2.tag).toBe('X');
    expect(data!.connections).toHaveLength(1);
    expect(data!.connections[0]).toMatchObject({ scope: 'wh', massStatus: 'fresh', eolStage: 'none' });
  });

  it('returns null for a soft-deleted map', async () => {
    await db.update(apMap).set({ deletedAt: new Date() }).where(eq(apMap.id, mapId));
    expect(await loadMapForView(mapId, TEST_VIEWER_ID)).toBeNull();
    await db.update(apMap).set({ deletedAt: null }).where(eq(apMap.id, mapId));
  });

  it('computes gate jumps to the hub and null for wormhole space', async () => {
    const k2Routes = await jumpsToHubs(K2);
    expect(k2Routes).toHaveLength(apertureConfig.ROUTE_HUBS.length);
    expect(k2Routes[0]).toMatchObject({ systemId: HUB, jumps: 2 });

    const whRoutes = await jumpsToHubs(WH);
    expect(whRoutes.every((r) => r.jumps === null)).toBe(true);
  });

  it('batches routes for many systems keyed by system id', async () => {
    const all = await routesForSystems([K1, K2]);
    expect(all[K1]![0]).toMatchObject({ jumps: 1 });
    expect(all[K2]![0]).toMatchObject({ jumps: 2 });
  });
});

async function cleanup() {
  if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
  await db.delete(apMap).where(eq(apMap.name, 'View Test Map'));
  await db.delete(apCharacter).where(eq(apCharacter.id, TEST_VIEWER_ID));
  if (testUserId) {
    await db.delete(apUser).where(eq(apUser.id, testUserId));
    testUserId = 0;
  }
  await db.delete(universeSystemStatic).where(eq(universeSystemStatic.systemId, WH));
  await db.delete(universeWormhole).where(eq(universeWormhole.typeId, WH_TYPE));
  await db.delete(universeType).where(eq(universeType.id, WH_TYPE));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db
    .delete(universeStargateEdge)
    .where(
      and(
        inArray(universeStargateEdge.fromSystemId, [HUB, K1, K2]),
        inArray(universeStargateEdge.toSystemId, [HUB, K1, K2]),
      ),
    );
  await db.delete(universeSystem).where(inArray(universeSystem.id, [K1, K2, WH]));
  if (hubInserted) {
    await db.delete(universeSystem).where(eq(universeSystem.id, HUB));
    hubInserted = false;
  }
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
