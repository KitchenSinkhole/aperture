// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapEvent,
  apMapSystem,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import { addSystem } from '@/lib/map/mutations/systems';
import { createConnection, updateConnection } from '@/lib/map/mutations/connections';
import {
  MAP_EXPORT_VERSION,
  buildMapExport,
  importMapData,
  mapExportSchema,
  type MapExportFile,
} from '@/lib/map/transfer';
import type { EolSource } from '@/types';

/**
 * `eol_source` provenance on every human EOL write path: create, update
 * (including the confirm-an-estimate re-stamp) and map transfer. Each write is
 * read back from both the row and the stored `ap_map_event.payload`, so a field
 * the zod schema strips fails the test.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98176001;
const CONSTELLATION = 98176001;
const SYSTEM_A = 98176002;
const SYSTEM_B = 98176003;

const MAP_NAME = 'EolSource Test Map';
const SOURCE_MAP_NAME = 'EolSource Transfer Source';
const TARGET_MAP_NAME = 'EolSource Transfer Target';

let mapId = 0n;
let sysA = 0n;
let sysB = 0n;

describe.skipIf(!run)('eol_source provenance on human EOL writes (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'EolSrc Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'EolSrc Test Const' });
    await db.insert(universeSystem).values([
      { id: SYSTEM_A, constellationId: CONSTELLATION, name: 'J176002', security: 'C3' },
      { id: SYSTEM_B, constellationId: CONSTELLATION, name: 'J176003', security: 'C4' },
    ]);

    mapId = await insertMap(MAP_NAME);
    [sysA, sysB] = await addTwoSystems(mapId);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('createConnection at a decaying stage stores observed; at none leaves NULL', async () => {
    const eol = await createConnection({
      mapId,
      characterId: null,
      sourceMapSystemId: sysA,
      targetMapSystemId: sysB,
      scope: 'wh',
      eolStage: 'eol',
    });
    expect(eol.ok && eol.data.kind).toBe('connection.create');
    if (!eol.ok || eol.data.kind !== 'connection.create') return;
    const eolId = BigInt(eol.data.id);
    expect((await connRow(eolId)).eolSource).toBe('observed');
    expect((await storedPayload(eol.eventId)).eolSource).toBe('observed');

    const plain = await createConnection({
      mapId,
      characterId: null,
      sourceMapSystemId: sysA,
      targetMapSystemId: sysB,
      scope: 'wh',
    });
    expect(plain.ok && plain.data.kind).toBe('connection.create');
    if (!plain.ok || plain.data.kind !== 'connection.create') return;
    expect((await connRow(BigInt(plain.data.id))).eolSource).toBeNull();
    expect((await storedPayload(plain.eventId)).eolSource).toBeNull();
  });

  it('updateConnection stores observed for every decaying stage; undoing it to none stores NULL', async () => {
    const id = await insertConn(mapId, { eolStage: 'none', eolSource: null, eolAt: null });
    const steps = [
      ['eol', 'observed'],
      ['critical', 'observed'],
      ['expired', 'observed'],
      ['none', null],
      ['none', null],
    ] as const;
    for (const [stage, source] of steps) {
      await expectStageWrite(id, stage, source);
    }
  });

  it('clearing an auto estimate to none stores observed, and a repeat none keeps it', async () => {
    const id = await insertConn(mapId, {
      eolStage: 'eol',
      eolSource: 'auto',
      eolAt: new Date(Date.now() - 60 * 60_000),
    });
    await expectStageWrite(id, 'none', 'observed');
    await expectStageWrite(id, 'none', 'observed');
  });

  it('an update that does not touch eolStage leaves eolSource alone', async () => {
    const id = await insertConn(mapId, {
      eolStage: 'eol',
      eolSource: 'auto',
      eolAt: new Date(Date.now() - 60 * 60_000),
    });
    const res = await updateConnection({
      mapId,
      connectionId: id,
      characterId: null,
      patch: { massStatus: 'reduced' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await connRow(id)).eolSource).toBe('auto');
    expect((await storedPayload(res.eventId)).eolSource).toBeUndefined();
  });

  it('confirming an auto estimate with the same eol flips it to observed and re-stamps eol_at', async () => {
    const autoAt = new Date(Date.now() - 2 * 60 * 60_000);
    const id = await insertConn(mapId, { eolStage: 'eol', eolSource: 'auto', eolAt: autoAt });

    const res = await updateConnection({
      mapId,
      connectionId: id,
      characterId: null,
      patch: { eolStage: 'eol' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = await connRow(id);
    expect(row.eolStage).toBe('eol');
    expect(row.eolSource).toBe('observed');
    expect(row.eolAtMs).toBeGreaterThan(autoAt.getTime() + 60 * 60_000);

    const payload = await storedPayload(res.eventId);
    expect(payload.eolSource).toBe('observed');
    expect(Date.parse(payload.eolAt as string)).toBe(row.eolAtMs);
  });

  it('re-applying the same eol on an observed row keeps eol_at', async () => {
    const seenAt = new Date(Date.now() - 2 * 60 * 60_000);
    const id = await insertConn(mapId, { eolStage: 'eol', eolSource: 'observed', eolAt: seenAt });

    const res = await updateConnection({
      mapId,
      connectionId: id,
      characterId: null,
      patch: { eolStage: 'eol' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await connRow(id);
    expect(row.eolSource).toBe('observed');
    expect(row.eolAtMs).toBe(seenAt.getTime());
  });

  it('a transfer round-trip preserves eol_source and the auto-EOL flag', async () => {
    const sourceMapId = await insertMap(SOURCE_MAP_NAME, { autoEolConnections: true });
    await addTwoSystems(sourceMapId);
    const eolAt = new Date(Date.now() - 60 * 60_000);
    await insertConn(sourceMapId, { eolStage: 'eol', eolSource: 'auto', eolAt });
    await insertConn(sourceMapId, { eolStage: 'critical', eolSource: 'observed', eolAt });
    await insertConn(sourceMapId, { eolStage: 'none', eolSource: 'observed', eolAt: null });
    await insertConn(sourceMapId, { eolStage: 'none', eolSource: null, eolAt: null });

    const exp = await buildMapExport(sourceMapId);
    expect(exp.map.autoEolConnections).toBe(true);
    expect(exp.connections.map((c) => [c.eolStage, c.eolSource])).toEqual([
      ['eol', 'auto'],
      ['critical', 'observed'],
      ['none', 'observed'],
      ['none', null],
    ]);

    const targetMapId = await insertMap(TARGET_MAP_NAME);
    const res = await importMapData({
      mapId: targetMapId,
      characterId: null,
      data: JSON.parse(JSON.stringify(exp)) as MapExportFile,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rows = await db
      .select({ eolStage: apMapConnection.eolStage, eolSource: apMapConnection.eolSource })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, targetMapId))
      .orderBy(apMapConnection.id);
    expect(rows.map((r) => [r.eolStage, r.eolSource])).toEqual([
      ['eol', 'auto'],
      ['critical', 'observed'],
      ['none', 'observed'],
      ['none', null],
    ]);

    const creates = res.data.payloads.filter((p) => p.kind === 'connection.create');
    const stored = await Promise.all(creates.map((p) => storedPayload(p.eventId)));
    expect(stored.map((p) => p.eolSource)).toEqual(['auto', 'observed', 'observed', null]);
  });

  it('a file without eolSource imports a decaying stage as observed and none as NULL', async () => {
    const targetMapId = await insertMap(TARGET_MAP_NAME);
    const conn = (id: string, eolStage: 'none' | 'eol') => ({
      id,
      source: '1',
      target: '2',
      scope: 'wh' as const,
      massStatus: 'fresh' as const,
      jumpMassClass: null,
      eolStage,
      preserveMass: false,
      isRolling: false,
    });
    const system = (id: string, systemId: number) => ({
      id,
      systemId,
      positionX: 0,
      positionY: 0,
      alias: null,
      tag: null,
      status: 'unknown' as const,
      intelNotes: null,
      locked: false,
    });
    // A pre-provenance file: no `eolSource`, no `autoEolConnections`.
    const legacy = {
      version: MAP_EXPORT_VERSION,
      map: {
        name: 'legacy',
        scope: 'all',
        type: 'private',
        deleteExpiredConnections: true,
        deleteEolConnections: true,
        trackAbyssalJumps: true,
      },
      systems: [system('1', SYSTEM_A), system('2', SYSTEM_B)],
      connections: [conn('1', 'eol'), conn('2', 'none')],
      signatures: [],
    };
    const parsed = mapExportSchema.parse(legacy);
    expect(parsed.map.autoEolConnections).toBe(false);

    const res = await importMapData({ mapId: targetMapId, characterId: null, data: parsed });
    expect(res.ok).toBe(true);

    const rows = await db
      .select({ eolStage: apMapConnection.eolStage, eolSource: apMapConnection.eolSource })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, targetMapId))
      .orderBy(apMapConnection.id);
    expect(rows.map((r) => [r.eolStage, r.eolSource])).toEqual([
      ['eol', 'observed'],
      ['none', null],
    ]);
  });

  it('an edited file pairing auto with a stage other than eol imports it as observed', async () => {
    const sourceMapId = await insertMap(SOURCE_MAP_NAME);
    await addTwoSystems(sourceMapId);
    const eolAt = new Date(Date.now() - 60 * 60_000);
    await insertConn(sourceMapId, { eolStage: 'eol', eolSource: 'auto', eolAt });
    await insertConn(sourceMapId, { eolStage: 'critical', eolSource: 'observed', eolAt });
    await insertConn(sourceMapId, { eolStage: 'expired', eolSource: 'observed', eolAt });
    const exp = await buildMapExport(sourceMapId);
    const edited = JSON.parse(JSON.stringify(exp)) as MapExportFile;
    for (const c of edited.connections) c.eolSource = 'auto';

    const targetMapId = await insertMap(TARGET_MAP_NAME);
    const res = await importMapData({
      mapId: targetMapId,
      characterId: null,
      data: mapExportSchema.parse(edited),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rows = await db
      .select({ eolStage: apMapConnection.eolStage, eolSource: apMapConnection.eolSource })
      .from(apMapConnection)
      .where(eq(apMapConnection.mapId, targetMapId))
      .orderBy(apMapConnection.id);
    expect(rows.map((r) => [r.eolStage, r.eolSource])).toEqual([
      ['eol', 'auto'],
      ['critical', 'observed'],
      ['expired', 'observed'],
    ]);

    const creates = res.data.payloads.filter((p) => p.kind === 'connection.create');
    const stored = await Promise.all(creates.map((p) => storedPayload(p.eventId)));
    expect(stored.map((p) => p.eolSource)).toEqual(['auto', 'observed', 'observed']);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function insertMap(name: string, extra: { autoEolConnections?: boolean } = {}) {
  const [m] = await db
    .insert(apMap)
    .values({ name, scope: 'all', type: 'private', ...extra })
    .returning({ id: apMap.id });
  return m!.id;
}

async function addTwoSystems(forMapId: bigint): Promise<[bigint, bigint]> {
  for (const [systemId, x] of [
    [SYSTEM_A, 0],
    [SYSTEM_B, 100],
  ] as const) {
    const res = await addSystem({
      mapId: forMapId,
      systemId,
      characterId: null,
      positionX: x,
      positionY: 0,
    });
    if (!res.ok) throw new Error(res.error);
  }
  const rows = await db
    .select({ id: apMapSystem.id, systemId: apMapSystem.systemId })
    .from(apMapSystem)
    .where(eq(apMapSystem.mapId, forMapId));
  const byId = new Map(rows.map((r) => [r.systemId, r.id]));
  return [byId.get(SYSTEM_A)!, byId.get(SYSTEM_B)!];
}

async function insertConn(
  forMapId: bigint,
  eol: { eolStage: 'none' | 'eol' | 'critical' | 'expired'; eolSource: EolSource | null; eolAt: Date | null },
): Promise<bigint> {
  const systems = await db
    .select({ id: apMapSystem.id, systemId: apMapSystem.systemId })
    .from(apMapSystem)
    .where(eq(apMapSystem.mapId, forMapId));
  const byId = new Map(systems.map((r) => [r.systemId, r.id]));
  const [row] = await db
    .insert(apMapConnection)
    .values({
      mapId: forMapId,
      sourceMapSystemId: byId.get(SYSTEM_A)!,
      targetMapSystemId: byId.get(SYSTEM_B)!,
      scope: 'wh',
      ...eol,
    })
    .returning({ id: apMapConnection.id });
  return row!.id;
}

async function expectStageWrite(
  id: bigint,
  stage: 'none' | 'eol' | 'critical' | 'expired',
  source: EolSource | null,
) {
  const res = await updateConnection({
    mapId,
    connectionId: id,
    characterId: null,
    patch: { eolStage: stage },
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const row = await connRow(id);
  expect(row.eolStage).toBe(stage);
  expect(row.eolSource).toBe(source);
  const payload = await storedPayload(res.eventId);
  expect(payload.eolStage).toBe(stage);
  expect(payload.eolSource).toBe(source);
}

async function connRow(id: bigint) {
  const [row] = await db
    .select({
      eolStage: apMapConnection.eolStage,
      eolSource: apMapConnection.eolSource,
      eolAtMs: sql<number | null>`(extract(epoch from ${apMapConnection.eolAt}) * 1000)::float8`,
    })
    .from(apMapConnection)
    .where(eq(apMapConnection.id, id));
  return row!;
}

async function storedPayload(eventId: number): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ payload: apMapEvent.payload })
    .from(apMapEvent)
    .where(eq(apMapEvent.id, BigInt(eventId)));
  return row!.payload as Record<string, unknown>;
}

async function cleanup() {
  const maps = await db
    .select({ id: apMap.id })
    .from(apMap)
    .where(inArray(apMap.name, [MAP_NAME, SOURCE_MAP_NAME, TARGET_MAP_NAME]));
  const ids = maps.map((m) => m.id);
  if (ids.length) {
    await db.delete(apMapConnection).where(inArray(apMapConnection.mapId, ids));
    await db.delete(apMapSystem).where(inArray(apMapSystem.mapId, ids));
    await db.delete(apMapEvent).where(inArray(apMapEvent.mapId, ids));
    await db.delete(apMap).where(inArray(apMap.id, ids));
  }
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYSTEM_A, SYSTEM_B]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
