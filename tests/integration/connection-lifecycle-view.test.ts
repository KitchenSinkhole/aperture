// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapConnectionLog,
  apMapEvent,
  apMapSignature,
  universeCategory,
  universeConstellation,
  universeGroup,
  universeRegion,
  universeSystem,
  universeType,
  universeWormhole,
} from '@/db/schema';
import { addSystem, removeSystem } from '@/lib/map/mutations/systems';
import { createConnection, deleteConnection } from '@/lib/map/mutations/connections';
import { restoreConnection } from '@/lib/map/mutations/restoreConnection';
import { pasteSignatures } from '@/lib/map/mutations/bulkSignatures';
import { eolExpiry } from '@/lib/jobs/tasks/eolExpiry';

/**
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * `ap_connection_lifecycle` (migration 0075) over real `connection.delete`
 * events written by every delete path, read back through the view.
 */
const run = process.env.RUN_DB_TESTS === '1';
const FAKE_HELPERS = {} as unknown as JobHelpers;

const REGION = 98175001;
const CONSTELLATION = 98175001;
const SYS_A = 98175002;
const SYS_B = 98175003;
const SYS_C = 98175004;
const SYS_D = 98175005;
const CATEGORY = 98175001;
const GROUP = 98175001;
const WH_O477 = 98175010;
const WH_K162 = 98175011;

const MAP_NAME = 'Connection Lifecycle View Map';
const HOUR = 3_600_000;

let mapId = 0n;
let msA = 0n;
let msB = 0n;
let msC = 0n;
let msD = 0n;

type LifecycleRow = {
  event_id: string;
  connection_id: string;
  source_system_id: number | null;
  target_system_id: number | null;
  cause: string;
  born_ms: number;
  died_ms: number;
  lifetime_h: number;
  last_alive_ms: number;
  clear_lag_h: number;
  was_rolled: boolean;
  was_dormant: boolean;
  wormhole_code: string | null;
  eol_stage_at_death: string;
};

describe.skipIf(!run)('ap_connection_lifecycle view (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Lifecycle Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Lifecycle Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'J175002', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'J175003', security: 'C3' },
      { id: SYS_C, constellationId: CONSTELLATION, name: 'J175004', security: 'C3' },
      { id: SYS_D, constellationId: CONSTELLATION, name: 'J175005', security: 'C3' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Lifecycle Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Lifecycle Grp' });
    await db.insert(universeType).values([
      { id: WH_O477, groupId: GROUP, name: 'Wormhole O477' },
      { id: WH_K162, groupId: GROUP, name: 'Wormhole K162' },
    ]);
    await db.insert(universeWormhole).values([
      { typeId: WH_O477, name: 'O477', sourceClasses: ['C3'], targetClass: 'C3' },
      { typeId: WH_K162, name: 'K162', sourceClasses: null, targetClass: null },
    ]);

    const [m] = await db
      .insert(apMap)
      .values({ name: MAP_NAME, scope: 'all', type: 'private', deleteEolConnections: true })
      .returning({ id: apMap.id });
    mapId = m!.id;
    msA = await addMapSystem(SYS_A);
    msB = await addMapSystem(SYS_B);
    msC = await addMapSystem(SYS_C);
    msD = await addMapSystem(SYS_D);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('a manual_removed delete yields one row with its lifetime, clear lag and code', async () => {
    const connId = await connect(msA, msB);
    await bindSig(msB, 'LCV-001', connId, WH_K162);
    const { bornAt } = await ageAndLogJump(connId);

    const res = await deleteConnection({ mapId, connectionId: connId, characterId: null, cause: 'manual_removed' });
    expect(res.ok).toBe(true);

    const row = await onlyRow(connId);
    expect(row).toMatchObject({
      cause: 'manual_removed',
      was_rolled: false,
      was_dormant: false,
      wormhole_code: 'K162',
      source_system_id: SYS_A,
      target_system_id: SYS_B,
    });
    expectTimings(row, bornAt, 3, 1);
  });

  it('a rolled delete yields one row flagged was_rolled', async () => {
    const connId = await connect(msA, msC, { isRolling: true });
    const { bornAt } = await ageAndLogJump(connId);

    const res = await deleteConnection({ mapId, connectionId: connId, characterId: null, cause: 'manual_removed' });
    expect(res.ok).toBe(true);

    const row = await onlyRow(connId);
    expect(row).toMatchObject({ cause: 'rolled', was_rolled: true, wormhole_code: null });
    expectTimings(row, bornAt, 3, 1);
  });

  it('a sig_orphaned delete yields one row with the dropped sig code', async () => {
    const connId = await connect(msB, msC);
    await bindSig(msC, 'LCV-002', connId, WH_O477);
    const { bornAt } = await ageAndLogJump(connId);

    const res = await pasteSignatures({
      mapId,
      mapSystemId: msC,
      characterId: null,
      rows: [],
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: true,
        removeOrphanedConnections: true,
      },
      defaultExpiresAt: new Date(Date.now() + 24 * HOUR),
    });
    expect(res.ok).toBe(true);

    const row = await onlyRow(connId);
    expect(row).toMatchObject({ cause: 'sig_orphaned', was_rolled: false, wormhole_code: 'O477' });
    expectTimings(row, bornAt, 3, 1);
  });

  it('a hole reaped mid-roll by eolExpiry yields one eol_reaped row flagged was_rolled', async () => {
    const [conn] = await db
      .insert(apMapConnection)
      .values({
        mapId,
        sourceMapSystemId: msA,
        targetMapSystemId: msB,
        scope: 'wh',
        eolStage: 'eol',
        eolSource: 'observed',
        eolAt: sql`now() - interval '5 hours'`,
        createdAt: sql`now() - interval '20 hours'`,
        updatedAt: sql`now() - interval '20 hours'`,
        confirmedAt: sql`now() - interval '20 hours'`,
        isRolling: true,
      })
      .returning({ id: apMapConnection.id, createdAt: apMapConnection.createdAt });
    await bindSig(msA, 'LCV-003', conn!.id, WH_O477);
    await db
      .insert(apMapConnectionLog)
      .values({ connectionId: conn!.id, mass: 1_000_000n, jumpedAt: sql`now() - interval '2 hours'` });

    await eolExpiry.run(null, FAKE_HELPERS);

    const row = await onlyRow(conn!.id);
    expect(row).toMatchObject({
      cause: 'eol_reaped',
      was_rolled: true,
      wormhole_code: 'O477',
      eol_stage_at_death: 'eol',
    });
    expectTimings(row, conn!.createdAt, 20, 2);
  });

  it('a hole dormanted by removeSystem, restored, then deleted yields exactly one row', async () => {
    const connId = await connect(msC, msD);
    const removed = await removeSystem({ mapId, mapSystemId: msD, characterId: null });
    expect(removed.ok).toBe(true);
    const restored = await restoreConnection({ mapId, connectionId: connId, characterId: null });
    expect(restored.ok).toBe(true);

    const res = await deleteConnection({ mapId, connectionId: connId, characterId: null, cause: 'manual_removed' });
    expect(res.ok).toBe(true);

    const row = await onlyRow(connId);
    expect(row).toMatchObject({ cause: 'manual_removed', was_dormant: false });
  });

  it('a pre-snapshot connection.delete event is absent from the view', async () => {
    const [seq] = (
      await db.execute(sql`SELECT nextval(pg_get_serial_sequence('ap_map_event','id')) AS id`)
    ).rows as Array<{ id: string }>;
    const eventId = BigInt(seq!.id);
    await db.insert(apMapEvent).values({
      id: eventId,
      mapId,
      characterId: null,
      occurredAt: new Date(),
      kind: 'connection.delete',
      payload: { id: '987654321', source: msA.toString(), target: msB.toString() },
    });

    const rows = (
      await db.execute(sql`SELECT event_id FROM ap_connection_lifecycle WHERE event_id = ${eventId}`)
    ).rows;
    expect(rows).toHaveLength(0);
  });
});

async function onlyRow(connectionId: bigint): Promise<LifecycleRow> {
  const rows = (
    await db.execute(
      sql`SELECT *,
            (extract(epoch FROM born_at) * 1000)::float8 AS born_ms,
            (extract(epoch FROM died_at) * 1000)::float8 AS died_ms,
            (extract(epoch FROM last_alive_at) * 1000)::float8 AS last_alive_ms
          FROM ap_connection_lifecycle
          WHERE map_id = ${mapId} AND connection_id = ${connectionId}`,
    )
  ).rows as LifecycleRow[];
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** `born_at` is the row's `created_at`; both spans are measured to the delete event. */
function expectTimings(row: LifecycleRow, bornAt: Date, lifetimeH: number, clearLagH: number) {
  expect(Math.abs(row.born_ms - bornAt.getTime())).toBeLessThan(1);
  expect(row.lifetime_h).toBeCloseTo((row.died_ms - row.born_ms) / HOUR, 6);
  expect(row.lifetime_h).toBeCloseTo(lifetimeH, 1);
  expect(row.clear_lag_h).toBeCloseTo((row.died_ms - row.last_alive_ms) / HOUR, 6);
  expect(row.clear_lag_h).toBeCloseTo(clearLagH, 1);
}

async function addMapSystem(systemId: number): Promise<bigint> {
  const res = await addSystem({ mapId, systemId, characterId: null });
  if (!res.ok) throw new Error(res.error);
  return BigInt((res.data as { id: string }).id);
}

async function connect(
  source: bigint,
  target: bigint,
  flags: { isRolling?: boolean } = {},
): Promise<bigint> {
  const res = await createConnection({
    mapId,
    characterId: null,
    sourceMapSystemId: source,
    targetMapSystemId: target,
    scope: 'wh',
    ...flags,
  });
  if (!res.ok) throw new Error(res.error);
  return BigInt((res.data as { id: string }).id);
}

async function bindSig(mapSystemId: bigint, sigId: string, connectionId: bigint, typeId: number) {
  await db.insert(apMapSignature).values({
    mapSystemId,
    sigId,
    mapConnectionId: connectionId,
    groupKey: 'wormhole',
    typeId,
    expiresAt: new Date(Date.now() + 24 * HOUR),
  });
}

/**
 * Backdate the connection's own stamps to 3h ago and log a jump 1h ago, so the
 * jump is the latest "alive" signal: lifetime ≈ 3h, clear lag ≈ 1h.
 */
async function ageAndLogJump(connectionId: bigint): Promise<{ bornAt: Date }> {
  const old = new Date(Date.now() - 3 * HOUR);
  const [conn] = await db
    .update(apMapConnection)
    .set({ createdAt: old, updatedAt: old, confirmedAt: old })
    .where(eq(apMapConnection.id, connectionId))
    .returning({ createdAt: apMapConnection.createdAt });
  await db
    .insert(apMapConnectionLog)
    .values({ connectionId, mass: 1_000_000n, jumpedAt: new Date(Date.now() - HOUR) });
  return { bornAt: conn!.createdAt };
}

async function cleanup() {
  if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db.delete(universeWormhole).where(inArray(universeWormhole.typeId, [WH_O477, WH_K162]));
  await db.delete(universeType).where(inArray(universeType.id, [WH_O477, WH_K162]));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYS_A, SYS_B, SYS_C, SYS_D]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
