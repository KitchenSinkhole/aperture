// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
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
import { boundWormholeCodeSql } from '@/lib/map/connectionDeathSnapshot';
import { addSystem } from '@/lib/map/mutations/systems';
import {
  createConnection,
  deleteConnection,
  updateConnection,
} from '@/lib/map/mutations/connections';
import { pasteSignatures } from '@/lib/map/mutations/bulkSignatures';
import type { MapEventPayload } from '@/lib/realtime/protocol';

/**
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * The `connection.delete` death snapshot on the manual delete path. Every
 * assertion reads the stored `ap_map_event.payload`, so a snapshot field the
 * zod schema does not declare (and therefore strips) fails here.
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98161001;
const CONSTELLATION = 98161001;
const SYS_A = 98161002;
const SYS_B = 98161003;
const SYS_C = 98161004;
const CATEGORY = 98161001;
const GROUP = 98161001;
const WH_O477 = 98161010;
const WH_K162 = 98161011;

const HOUR = 3_600_000;

let mapId = 0n;
let msA = 0n;
let msB = 0n;
let msC = 0n;

describe.skipIf(!run)('connection.delete death snapshot (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Death Snap Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Death Snap Const' });
    await db.insert(universeSystem).values([
      { id: SYS_A, constellationId: CONSTELLATION, name: 'J161002', security: 'C3' },
      { id: SYS_B, constellationId: CONSTELLATION, name: 'J161003', security: 'C3' },
      { id: SYS_C, constellationId: CONSTELLATION, name: 'J161004', security: 'C3' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Death Snap Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Death Snap Grp' });
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
      .values({ name: 'Death Snapshot Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapId = m!.id;
    msA = await addMapSystem(SYS_A);
    msB = await addMapSystem(SYS_B);
    msC = await addMapSystem(SYS_C);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('a plain user delete tags manual_removed with the full snapshot and the bound code', async () => {
    const connId = await connect(msA, msB);
    await bindSig(msA, 'AAA-001', connId, WH_O477);
    await bindSig(msB, 'BBB-001', connId, WH_K162);
    const { bornAt, jumpedAt } = await ageAndLogJump(connId);

    const res = await deleteConnection({ mapId, connectionId: connId, characterId: null, cause: 'manual_removed' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const stored = await storedPayload(res.eventId);
    expect(stored).toMatchObject({
      kind: 'connection.delete',
      id: connId.toString(),
      source: msA.toString(),
      target: msB.toString(),
      cause: 'manual_removed',
      bornAt: bornAt.toISOString(),
      scope: 'wh',
      massStatus: 'fresh',
      isRolling: false,
      isStatic: false,
      eolStage: 'none',
      eolAt: null,
      wasDormant: false,
      wormholeCode: 'O477',
    });
    expect(Date.parse(stored.lastAliveAt as string)).toBeGreaterThanOrEqual(jumpedAt.getTime());
  });

  it('a delete while rolling or mass-critical tags rolled', async () => {
    const rolling = await connect(msA, msB, { isRolling: true });
    const rollingTimes = await ageAndLogJump(rolling);
    const critical = await connect(msB, msC, { massStatus: 'critical' });
    await ageAndLogJump(critical);

    const r1 = await deleteConnection({ mapId, connectionId: rolling, characterId: null, cause: 'manual_removed' });
    const r2 = await deleteConnection({ mapId, connectionId: critical, characterId: null, cause: 'manual_removed' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    const s1 = await storedPayload(r1.eventId);
    expect(s1).toMatchObject({
      cause: 'rolled',
      isRolling: true,
      bornAt: rollingTimes.bornAt.toISOString(),
      wormholeCode: null,
    });
    expect(Date.parse(s1.lastAliveAt as string)).toBeGreaterThanOrEqual(rollingTimes.jumpedAt.getTime());
    expect(await storedPayload(r2.eventId)).toMatchObject({ cause: 'rolled', massStatus: 'critical' });
  });

  it('a dormant connection records wasDormant', async () => {
    const connId = await connect(msA, msC);
    await db.update(apMapConnection).set({ confirmedAt: null }).where(eq(apMapConnection.id, connId));

    const res = await deleteConnection({ mapId, connectionId: connId, characterId: null, cause: 'manual_removed' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await storedPayload(res.eventId)).toMatchObject({ wasDormant: true });
  });

  it('a bulk paste dropping a mapped sig tags sig_orphaned and keeps the dropped sig code', async () => {
    const connId = await connect(msA, msC);
    await bindSig(msA, 'ORP-001', connId, WH_O477);
    const { bornAt, jumpedAt } = await ageAndLogJump(connId);

    const res = await pasteSignatures({
      mapId,
      mapSystemId: msA,
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
    if (!res.ok) return;

    const del = res.data.payloads.find(
      (p): p is Extract<MapEventPayload, { kind: 'connection.delete' }> =>
        p.kind === 'connection.delete' && p.id === connId.toString(),
    );
    expect(del).toBeDefined();
    const stored = await storedPayload(del!.eventId);
    expect(stored).toMatchObject({
      cause: 'sig_orphaned',
      bornAt: bornAt.toISOString(),
      wormholeCode: 'O477',
      wasDormant: false,
    });
    expect(Date.parse(stored.lastAliveAt as string)).toBeGreaterThanOrEqual(jumpedAt.getTime());
  });

  it('a re-pasted bound sig advances confirmed_at, which lastAliveAt then reads', async () => {
    const live = await connect(msB, msC);
    await bindSig(msB, 'HBT-001', live, WH_O477);
    const { jumpedAt } = await ageAndLogJump(live);
    const dormant = await connect(msA, msB);
    await bindSig(msB, 'HBT-002', dormant, WH_O477);
    await db.update(apMapConnection).set({ confirmedAt: null }).where(eq(apMapConnection.id, dormant));

    const res = await pasteSignatures({
      mapId,
      mapSystemId: msB,
      characterId: null,
      rows: ['HBT-001', 'HBT-002'].map((sigId) => ({
        sigId,
        name: 'Unstable Wormhole',
        groupName: 'Wormhole',
        signal: '100.0%',
        classKind: 'signature' as const,
        groupKey: 'wormhole' as const,
        typeId: WH_O477,
      })),
      options: {
        addMissing: false,
        updateExisting: true,
        removeMissing: false,
        removeOrphanedConnections: false,
      },
      defaultExpiresAt: new Date(Date.now() + 24 * HOUR),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rows = await db
      .select({ id: apMapConnection.id, confirmedAt: apMapConnection.confirmedAt })
      .from(apMapConnection)
      .where(inArray(apMapConnection.id, [live, dormant]));
    const confirmed = new Map(rows.map((r) => [r.id, r.confirmedAt]));
    const heartbeat = confirmed.get(live)!;
    expect(heartbeat.getTime()).toBeGreaterThan(jumpedAt.getTime());
    expect(confirmed.get(dormant)).toBeNull();

    const del = await deleteConnection({ mapId, connectionId: live, characterId: null, cause: 'manual_removed' });
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    expect(Date.parse((await storedPayload(del.eventId)).lastAliveAt as string)).toBe(heartbeat.getTime());
  });

  it('an expired hole does not count its own expire write, or later edits, as alive', async () => {
    const id = await connect(msA, msC);
    const { jumpedAt } = await ageAndLogJump(id);
    for (const patch of [{ eolStage: 'expired' as const }, { isRolling: false }]) {
      const res = await updateConnection({ mapId, connectionId: id, characterId: null, patch });
      expect(res.ok).toBe(true);
    }

    const del = await deleteConnection({ mapId, connectionId: id, characterId: null, cause: 'manual_removed' });
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    const stored = await storedPayload(del.eventId);
    expect(stored.eolStage).toBe('expired');
    expect(Date.parse(stored.lastAliveAt as string)).toBe(jumpedAt.getTime());
  });

  it('boundWormholeCodeSql applies the bound-signature code rule', async () => {
    const codeOf = async (codes: string[]) => {
      const values = codes.length > 0 ? codes : [null];
      const res = await db.execute<{ code: string | null }>(
        sql`select ${boundWormholeCodeSql(sql`v.code`)} as code from (values ${sql.join(
          values.map((c) => sql`(${c}::text)`),
          sql`, `,
        )}) v(code) where v.code is not null`,
      );
      return res.rows[0]!.code;
    };
    expect(await codeOf(['O477', 'K162'])).toBe('O477');
    expect(await codeOf(['O477', 'O477'])).toBe('O477');
    expect(await codeOf(['K162', 'K162'])).toBe('K162');
    expect(await codeOf([])).toBeNull();
    expect(await codeOf(['O477', 'B274'])).toBeNull();
    expect(await codeOf(['O477', 'B274', 'K162'])).toBeNull();
  });
});

async function addMapSystem(systemId: number): Promise<bigint> {
  const res = await addSystem({ mapId, systemId, characterId: null });
  if (!res.ok) throw new Error(res.error);
  return BigInt((res.data as { id: string }).id);
}

async function connect(
  source: bigint,
  target: bigint,
  flags: { isRolling?: boolean; massStatus?: 'fresh' | 'reduced' | 'critical' } = {},
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
 * jump is the latest "alive" signal and `lastAliveAt` must come from the log.
 */
async function ageAndLogJump(connectionId: bigint): Promise<{ bornAt: Date; jumpedAt: Date }> {
  const old = new Date(Date.now() - 3 * HOUR);
  const [conn] = await db
    .update(apMapConnection)
    .set({ createdAt: old, updatedAt: old, confirmedAt: old })
    .where(eq(apMapConnection.id, connectionId))
    .returning({ createdAt: apMapConnection.createdAt });
  const [log] = await db
    .insert(apMapConnectionLog)
    .values({ connectionId, mass: 1_000_000n, jumpedAt: new Date(Date.now() - HOUR) })
    .returning({ jumpedAt: apMapConnectionLog.jumpedAt });
  return { bornAt: conn!.createdAt, jumpedAt: log!.jumpedAt };
}

async function storedPayload(eventId: number): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ payload: apMapEvent.payload })
    .from(apMapEvent)
    .where(eq(apMapEvent.id, BigInt(eventId)));
  if (!row) throw new Error(`event ${eventId} not stored`);
  return row.payload as Record<string, unknown>;
}

async function cleanup() {
  if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
  await db.delete(apMap).where(eq(apMap.name, 'Death Snapshot Map'));
  await db.delete(universeWormhole).where(inArray(universeWormhole.typeId, [WH_O477, WH_K162]));
  await db.delete(universeType).where(inArray(universeType.id, [WH_O477, WH_K162]));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYS_A, SYS_B, SYS_C]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
