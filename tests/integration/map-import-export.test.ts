// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapEvent,
  apMapSignature,
  apMapSystem,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeSystem,
  universeType,
  universeWormhole,
} from '@/db/schema';
import { addSystem } from '@/lib/map/mutations/systems';
import { createConnection } from '@/lib/map/mutations/connections';
import { createSignature } from '@/lib/map/mutations/signatures';
import {
  MAP_EXPORT_VERSION,
  buildMapExport,
  importMapData,
  type MapExportFile,
} from '@/lib/map/transfer';

/**
 * Map JSON export + merge-import.
 * Verifies a round-trip (export a populated map, import it into a fresh map)
 * remaps system/connection endpoints correctly, against real Postgres.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98042001;
const CONSTELLATION = 98042001;
const SYSTEM_A = 98042002;
const SYSTEM_B = 98042003;
const CATEGORY = 98042001;
const GROUP_WORMHOLE = 98042001;
const TYPE_UNSTABLE = 98042001;

const SOURCE_MAP_NAME = 'ImportExport Source Map';
const TARGET_MAP_NAME = 'ImportExport Target Map';

let sourceMapId = 0n;

describe.skipIf(!run)('map import/export — round-trip + remap (real Postgres)', () => {
  let sourceSystemA = 0n;
  let sourceSystemB = 0n;
  let sourceConnId = 0n;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'IE Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'IE Test Const' });
    await db.insert(universeSystem).values([
      { id: SYSTEM_A, constellationId: CONSTELLATION, name: 'J160001', security: 'C4' },
      { id: SYSTEM_B, constellationId: CONSTELLATION, name: 'J160002', security: 'C5' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'IE Cat' });
    await db
      .insert(universeGroup)
      .values({ id: GROUP_WORMHOLE, categoryId: CATEGORY, name: 'Wormhole' });
    await db
      .insert(universeType)
      .values({ id: TYPE_UNSTABLE, groupId: GROUP_WORMHOLE, name: 'Unstable Wormhole' });
    await db
      .insert(universeWormhole)
      .values({ typeId: TYPE_UNSTABLE, name: 'X902', sourceClasses: ['H'], targetClass: 'H' });

    const [m] = await db
      .insert(apMap)
      .values({ name: SOURCE_MAP_NAME, scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    sourceMapId = m!.id;

    const resA = await addSystem({
      mapId: sourceMapId,
      systemId: SYSTEM_A,
      characterId: null,
      positionX: 100,
      positionY: 200,
    });
    const resB = await addSystem({ mapId: sourceMapId, systemId: SYSTEM_B, characterId: null });
    expect(resA.ok && resB.ok).toBe(true);
    sourceSystemA = BigInt((resA as { ok: true; data: { id: string } }).data.id);
    sourceSystemB = BigInt((resB as { ok: true; data: { id: string } }).data.id);

    // Give system A some intel so the export round-trips it.
    await db
      .update(apMapSystem)
      .set({ alias: 'Home', intelNotes: 'staging', status: 'friendly' })
      .where(eq(apMapSystem.id, sourceSystemA));

    const conn = await createConnection({
      mapId: sourceMapId,
      characterId: null,
      sourceMapSystemId: sourceSystemA,
      targetMapSystemId: sourceSystemB,
      scope: 'wh',
    });
    expect(conn.ok).toBe(true);
    sourceConnId = BigInt((conn as { ok: true; data: { id: string } }).data.id);

    // A wormhole sig on A bound to the connection, plus a plain gas sig on B.
    const whSig = await createSignature({
      mapId: sourceMapId,
      mapSystemId: sourceSystemA,
      characterId: null,
      sigId: 'ABC-001',
      groupKey: 'wormhole',
      typeId: TYPE_UNSTABLE,
      mapConnectionId: sourceConnId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const gasSig = await createSignature({
      mapId: sourceMapId,
      mapSystemId: sourceSystemB,
      characterId: null,
      sigId: 'DEF-002',
      groupKey: 'gas',
      typeId: null,
      name: 'Barren Reservoir',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(whSig.ok && gasSig.ok).toBe(true);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('buildMapExport: serialises the full visible map state', async () => {
    const exp = await buildMapExport(sourceMapId);
    expect(exp.version).toBe(MAP_EXPORT_VERSION);
    expect(exp.map).toMatchObject({ name: SOURCE_MAP_NAME, scope: 'all', type: 'private' });
    expect(exp.systems).toHaveLength(2);
    expect(exp.connections).toHaveLength(1);
    expect(exp.signatures).toHaveLength(2);

    const sysA = exp.systems.find((s) => s.systemId === SYSTEM_A)!;
    expect(sysA).toMatchObject({
      alias: 'Home',
      intelNotes: 'staging',
      status: 'friendly',
      positionX: 100,
      positionY: 200,
    });

    // The connection references export-local system ids, and the WH sig
    // references the export-local connection id.
    const conn = exp.connections[0]!;
    expect(conn.source).toBe(sourceSystemA.toString());
    expect(conn.target).toBe(sourceSystemB.toString());
    const whSig = exp.signatures.find((s) => s.sigId === 'ABC-001')!;
    expect(whSig.mapConnectionId).toBe(conn.id);
  });

  it('importMapData: merges into a fresh map with endpoints + sig links remapped', async () => {
    const exp = await buildMapExport(sourceMapId);

    const [target] = await db
      .insert(apMap)
      .values({ name: TARGET_MAP_NAME, scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    const targetMapId = target!.id;

    const result = await importMapData({ mapId: targetMapId, characterId: null, data: exp });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toEqual({ systems: 2, connections: 1, signatures: 2 });
    // One event per imported row (2 + 1 + 2).
    expect(result.data.payloads).toHaveLength(5);

    const targetSystems = await db
      .select({ id: apMapSystem.id, systemId: apMapSystem.systemId, alias: apMapSystem.alias })
      .from(apMapSystem)
      .where(eq(apMapSystem.mapId, targetMapId));
    expect(targetSystems).toHaveLength(2);
    const bySystemId = new Map(targetSystems.map((s) => [s.systemId, s.id]));
    expect(bySystemId.get(SYSTEM_A)).toBeDefined();
    // Intel round-tripped.
    expect(targetSystems.find((s) => s.systemId === SYSTEM_A)!.alias).toBe('Home');

    const [targetConn] = await db
      .select({
        id: apMapConnection.id,
        source: apMapConnection.sourceMapSystemId,
        target: apMapConnection.targetMapSystemId,
        scope: apMapConnection.scope,
      })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, targetMapId));
    expect(targetConn).toBeDefined();
    // Endpoints remapped to the freshly-created target system rows.
    expect(targetConn!.source).toBe(bySystemId.get(SYSTEM_A));
    expect(targetConn!.target).toBe(bySystemId.get(SYSTEM_B));

    const targetSigs = await db
      .select({
        sigId: apMapSignature.sigId,
        mapSystemId: apMapSignature.mapSystemId,
        mapConnectionId: apMapSignature.mapConnectionId,
      })
      .from(apMapSignature)
      .where(inArray(apMapSignature.mapSystemId, targetSystems.map((s) => s.id)));
    expect(targetSigs).toHaveLength(2);
    const whSig = targetSigs.find((s) => s.sigId === 'ABC-001')!;
    // Sig lives in the remapped system A and is bound to the remapped connection.
    expect(whSig.mapSystemId).toBe(bySystemId.get(SYSTEM_A));
    expect(whSig.mapConnectionId).toBe(targetConn!.id);

    await deleteMap(targetMapId);
  });

  it('import skips connections whose endpoints do not resolve', async () => {
    const [target] = await db
      .insert(apMap)
      .values({ name: TARGET_MAP_NAME, scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    const targetMapId = target!.id;

    const data: MapExportFile = {
      version: MAP_EXPORT_VERSION,
      map: {
        name: 'x',
        scope: 'all',
        type: 'private',
        icon: null,
        deleteExpiredConnections: true,
        deleteEolConnections: true,
        trackAbyssalJumps: true,
        logActivity: true,
      },
      systems: [
        {
          id: '1',
          systemId: SYSTEM_A,
          positionX: 0,
          positionY: 0,
          alias: null,
          tag: null,
          status: 'unknown',
          intelNotes: null,
          locked: false,
        },
      ],
      // `source: '999'` references a system id not present in `systems` → skipped.
      connections: [
        {
          id: '1',
          source: '1',
          target: '999',
          scope: 'wh',
          massStatus: 'fresh',
          jumpMassClass: null,
          eolStage: 'none',
          preserveMass: false,
          isRolling: false,
          isStatic: false,
          sourceBubbled: false,
          targetBubbled: false,
        },
      ],
      signatures: [],
    };

    const result = await importMapData({ mapId: targetMapId, characterId: null, data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toEqual({ systems: 1, connections: 0, signatures: 0 });

    const conns = await db
      .select({ id: apMapConnection.id })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, targetMapId));
    expect(conns).toHaveLength(0);

    await deleteMap(targetMapId);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function deleteMap(id: bigint) {
  await db
    .delete(apMapSignature)
    .where(
      sql`${apMapSignature.mapSystemId} IN (SELECT id FROM ap_map_system WHERE map_id = ${id})`,
    );
  await db.delete(apMapConnection).where(eq(apMapConnection.mapId, id));
  await db.delete(apMapSystem).where(eq(apMapSystem.mapId, id));
  await db.delete(apMapEvent).where(eq(apMapEvent.mapId, id));
  await db.delete(apMap).where(eq(apMap.id, id));
}

async function cleanup() {
  if (sourceMapId) await deleteMap(sourceMapId);
  await db.delete(apMap).where(inArray(apMap.name, [SOURCE_MAP_NAME, TARGET_MAP_NAME]));
  await db.delete(universeWormhole).where(eq(universeWormhole.typeId, TYPE_UNSTABLE));
  await db.delete(universeType).where(eq(universeType.id, TYPE_UNSTABLE));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP_WORMHOLE));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYSTEM_A, SYSTEM_B]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
