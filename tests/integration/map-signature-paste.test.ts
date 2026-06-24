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
import { pasteSignatures } from '@/lib/map/mutations/bulkSignatures';
import { resolveSignatureRows, type ResolvedSigRow } from '@/lib/map/signatureReader';

/**
 * Bulk signature-paste orchestrator.
 * Verifies the diff/atomic-commit contract end-to-end against real Postgres.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98041001;
const CONSTELLATION = 98041001;
const SYSTEM_A = 98041002;
const SYSTEM_B = 98041003;
const CATEGORY = 98041001;
const GROUP_WORMHOLE = 98041001;
const GROUP_GAS = 98041002;
const TYPE_UNSTABLE = 98041001;
const TYPE_GAS_BARREN = 98041002;

let mapId = 0n;

describe.skipIf(!run)('bulk signature paste — diff / atomic commit (real Postgres)', () => {
  let mapSystemIdA = 0n;
  let mapSystemIdB = 0n;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Paste Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Paste Test Const' });
    await db.insert(universeSystem).values([
      { id: SYSTEM_A, constellationId: CONSTELLATION, name: 'J150001', security: 'C4' },
      { id: SYSTEM_B, constellationId: CONSTELLATION, name: 'J150002', security: 'C5' },
    ]);
    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Paste Cat' });
    await db.insert(universeGroup).values([
      { id: GROUP_WORMHOLE, categoryId: CATEGORY, name: 'Wormhole' },
      { id: GROUP_GAS, categoryId: CATEGORY, name: 'Cosmic Signature' },
    ]);
    await db.insert(universeType).values([
      { id: TYPE_UNSTABLE, groupId: GROUP_WORMHOLE, name: 'Unstable Wormhole' },
      { id: TYPE_GAS_BARREN, groupId: GROUP_GAS, name: 'Barren Reservoir' },
    ]);
    // `universe_wormhole.name` is the short WH code (B274 / K162); the seeded
    // type's `universe_type.name` is irrelevant to the resolver. Use a synthetic
    // code that won't collide with real SDE rows (the live `universe_wormhole`
    // also has a `B274` row at a different `typeId`).
    await db
      .insert(universeWormhole)
      .values({ typeId: TYPE_UNSTABLE, name: 'X901', sourceClasses: ['H'], targetClass: 'H' });

    const [m] = await db
      .insert(apMap)
      .values({ name: 'Bulk Paste Test Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapId = m!.id;

    const resA = await addSystem({ mapId, systemId: SYSTEM_A, characterId: null });
    expect(resA.ok).toBe(true);
    const resB = await addSystem({ mapId, systemId: SYSTEM_B, characterId: null });
    expect(resB.ok).toBe(true);
    mapSystemIdA = BigInt((resA as { ok: true; data: { id: string } }).data.id);
    mapSystemIdB = BigInt((resB as { ok: true; data: { id: string } }).data.id);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('diff: adds new, updates classification, removes missing — one event per affected sig', async () => {
    // Seed two existing sigs: ABC-001 (classified) and DEF-002 (unclassified).
    const seed1 = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'ABC-001',
      groupKey: null,
      typeId: null,
      name: 'preserve me',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(seed1.ok).toBe(true);
    const seed2 = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'DEF-002',
      groupKey: null,
      typeId: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(seed2.ok).toBe(true);

    const beforeEvents = await eventCount();

    // Paste: ABC-001 newly classified, GHI-003 new, JKL-004 new; DEF-002 absent.
    const rows: ResolvedSigRow[] = [
      {
        sigId: 'ABC-001',
        name: 'Unstable Wormhole',
        groupName: 'Wormhole',
        signal: '100.0%',
        groupKey: 'wormhole',
        typeId: TYPE_UNSTABLE,
      },
      {
        sigId: 'GHI-003',
        name: 'Barren Reservoir',
        groupName: 'Gas Site',
        signal: '100.0%',
        groupKey: 'gas',
        typeId: null,
      },
      {
        sigId: 'JKL-004',
        name: null,
        groupName: null,
        signal: '4.2%',
        groupKey: null,
        typeId: null,
      },
    ];

    const result = await pasteSignatures({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      rows,
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: true,
        removeOrphanedConnections: false,
      },
      defaultExpiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 new + 1 update + 1 delete = 4 events.
    expect(result.data.summary).toEqual({
      added: 2,
      updated: 1,
      removed: 1,
      connectionsRemoved: 0,
    });
    expect(await eventCount()).toBe(beforeEvents + 4);
    expect(result.data.payloads).toHaveLength(4);

    // Existing classified row preserved its name, gained groupKey/typeId.
    const [abc] = await db
      .select({
        sigId: apMapSignature.sigId,
        name: apMapSignature.name,
        groupKey: apMapSignature.groupKey,
        typeId: apMapSignature.typeId,
      })
      .from(apMapSignature)
      .where(eq(apMapSignature.mapSystemId, mapSystemIdA));
    expect(abc).toBeDefined();

    const finalSigs = await db
      .select({
        sigId: apMapSignature.sigId,
        name: apMapSignature.name,
        groupKey: apMapSignature.groupKey,
      })
      .from(apMapSignature)
      .where(eq(apMapSignature.mapSystemId, mapSystemIdA));
    const sigIds = finalSigs.map((s) => s.sigId).sort();
    expect(sigIds).toEqual(['ABC-001', 'GHI-003', 'JKL-004']);

    const abcRow = finalSigs.find((s) => s.sigId === 'ABC-001');
    expect(abcRow).toMatchObject({
      name: 'preserve me', // unchanged — paste shouldn't clobber name
      groupKey: 'wormhole',
    });

    // Clean for the next test.
    await db
      .delete(apMapSignature)
      .where(eq(apMapSignature.mapSystemId, mapSystemIdA));
  });

  it('fills a blank name on re-paste (low-strength scan → high-strength reveal) without clobbering a typed name', async () => {
    // Row first added blind: group known from an early scan, site name not yet
    // revealed. A second seed already carries a name and must be preserved.
    const blind = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'BLN-001',
      groupKey: 'gas',
      typeId: null,
      name: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(blind.ok).toBe(true);
    const typed = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'TYP-002',
      groupKey: 'gas',
      typeId: null,
      name: 'hand typed name',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(typed.ok).toBe(true);

    const result = await pasteSignatures({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      rows: [
        {
          sigId: 'BLN-001',
          name: 'Barren Reservoir',
          groupName: 'Gas Site',
          signal: '100.0%',
          groupKey: 'gas',
          typeId: null,
        },
        {
          sigId: 'TYP-002',
          name: 'Vast Frontier Reservoir',
          groupName: 'Gas Site',
          signal: '100.0%',
          groupKey: 'gas',
          typeId: null,
        },
      ],
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: false,
        removeOrphanedConnections: false,
      },
      defaultExpiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(result.ok).toBe(true);

    const sigs = await db
      .select({ sigId: apMapSignature.sigId, name: apMapSignature.name })
      .from(apMapSignature)
      .where(eq(apMapSignature.mapSystemId, mapSystemIdA));
    expect(sigs.find((s) => s.sigId === 'BLN-001')?.name).toBe('Barren Reservoir');
    // Non-blank existing name is preserved — paste never clobbers typed input.
    expect(sigs.find((s) => s.sigId === 'TYP-002')?.name).toBe('hand typed name');

    await db.delete(apMapSignature).where(eq(apMapSignature.mapSystemId, mapSystemIdA));
  });

  it('removeOrphanedConnections: also emits connection.delete for sigs bound to a connection', async () => {
    // Seed a connection from A to B and a sig on A bound to it.
    const conn = await createConnection({
      mapId,
      characterId: null,
      sourceMapSystemId: mapSystemIdA,
      targetMapSystemId: mapSystemIdB,
      scope: 'wh',
    });
    expect(conn.ok).toBe(true);
    const connectionId = BigInt((conn as { ok: true; data: { id: string } }).data.id);

    const sig = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'WHA-001',
      mapConnectionId: connectionId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(sig.ok).toBe(true);

    const beforeEvents = await eventCount();

    const result = await pasteSignatures({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      rows: [], // empty paste → existing sig disappears
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: true,
        removeOrphanedConnections: true,
      },
      defaultExpiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toEqual({
      added: 0,
      updated: 0,
      removed: 1,
      connectionsRemoved: 1,
    });
    // 1 signature.delete + 1 connection.delete.
    expect(await eventCount()).toBe(beforeEvents + 2);

    // The connection row is gone.
    const conns = await db
      .select({ id: apMapConnection.id })
      .from(apMapConnection)
      .where(eq(apMapConnection.id, connectionId));
    expect(conns).toHaveLength(0);
  });

  it('resolveHomefrontRows', async () => {
    const rows = await resolveSignatureRows([
      {
        sigId: 'XFV-531',
        name: 'Suspicious Signal: Block the Broadcast',
        groupName: 'Homefront Operation Site - Combat Site',
        signal: '100.0%'
      }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sigId: 'XFV-531',
      groupKey: 'combat',
      typeId: null,
      name: 'Suspicious Signal: Block the Broadcast',
    });
  });

  it('resolveFactionalWarfareRows', async () => {
    const rows = await resolveSignatureRows([
      {
        sigId: 'VBA-720',
        name: 'Minmatar Small ADV-1',
        groupName: 'Factional Warfare Site - Combat Site',
        signal: '100.0%'
      }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sigId: 'VBA-720',
      groupKey: 'combat',
      typeId: null,
      name: 'Minmatar Small ADV-1',
    });
  });

  it('resolveSignatureRows: classifies the seven scanner groups + WH name → typeId', async () => {
    const rows = await resolveSignatureRows([
      { sigId: 'WH1-001', name: 'X901', groupName: 'Wormhole', signal: '100.0%' },
      // Low-strength wormhole: EVE emits "Wormhole" in both Name and Group.
      { sigId: 'WH2-002', name: 'Wormhole', groupName: 'Wormhole', signal: '4.2%' },
      // Cosmic-site row: name carried through, typeId null.
      {
        sigId: 'REL-003',
        name: 'Forgotten Perimeter Habitation Coils',
        groupName: 'Relic Site',
        signal: '100.0%',
      },
      // Unknown group: low-strength row with no Group cell.
      { sigId: 'UNK-004', name: null, groupName: null, signal: '4.2%' },
      // Combat scanner group.
      {
        sigId: 'COM-005',
        name: 'Fortification Frontier Stronghold',
        groupName: 'Combat Site',
        signal: '100.0%',
      },
    ]);

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      sigId: 'WH1-001',
      groupKey: 'wormhole',
      typeId: TYPE_UNSTABLE,
      name: 'X901',
    });
    // Low-strength: groupKey is set (group cell was meaningful) but name +
    // typeId are null after the low-strength filter.
    expect(rows[1]).toMatchObject({
      sigId: 'WH2-002',
      groupKey: 'wormhole',
      typeId: null,
      name: null,
    });
    expect(rows[2]).toMatchObject({
      sigId: 'REL-003',
      groupKey: 'relic',
      typeId: null,
      name: 'Forgotten Perimeter Habitation Coils',
    });
    expect(rows[3]).toMatchObject({
      sigId: 'UNK-004',
      groupKey: null,
      typeId: null,
      name: null,
    });
    expect(rows[4]).toMatchObject({
      sigId: 'COM-005',
      groupKey: 'combat',
      typeId: null,
      name: 'Fortification Frontier Stronghold',
    });
  });

  it('rollback: a mid-batch failure aborts the whole transaction', async () => {
    // Seed one sig on mapSystemIdA (owned by `mapId`).
    const beforeEvents = await eventCount();
    const beforeRows = await sigCount();

    const seed = await createSignature({
      mapId,
      mapSystemId: mapSystemIdA,
      characterId: null,
      sigId: 'RB1-001',
      groupKey: null,
      typeId: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(seed.ok).toBe(true);

    // Create a second map; call pasteSignatures with the WRONG mapId so the
    // ownership check inside updateSignature throws mid-batch. The batch
    // contains an OK1-001 row that would otherwise be created — verify it
    // doesn't persist (whole tx rolled back).
    const [otherMap] = await db
      .insert(apMap)
      .values({ name: 'Rollback Other Map', scope: 'wh', type: 'private' })
      .returning({ id: apMap.id });

    const conflict = await pasteSignatures({
      mapId: otherMap!.id,
      mapSystemId: mapSystemIdA,
      characterId: null,
      rows: [
        // RB1-001 exists → bulk attempts an update; `updateSignature` checks
        // that the sig's mapSystem belongs to `input.mapId`. It doesn't here
        // → throws → outer transaction rolls back.
        {
          sigId: 'RB1-001',
          name: null,
          groupName: 'Wormhole',
          signal: '100.0%',
          groupKey: 'wormhole',
          typeId: null,
        },
        // Would be created if the tx succeeded; verifies the rollback.
        {
          sigId: 'OK1-001',
          name: null,
          groupName: null,
          signal: '100%',
          groupKey: null,
          typeId: null,
        },
      ],
      options: {
        addMissing: true,
        updateExisting: true,
        removeMissing: false,
        removeOrphanedConnections: false,
      },
      defaultExpiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(conflict.ok).toBe(false);
    // Only the seed's `signature.create` event persists.
    expect(await eventCount()).toBe(beforeEvents + 1);
    // Only the seeded sig persists; OK1-001 rolled back.
    expect(await sigCount()).toBe(beforeRows + 1);

    await db.delete(apMap).where(eq(apMap.id, otherMap!.id));
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function eventCount(): Promise<number> {
  const rows = (
    await db.execute(sql`SELECT count(*)::int AS count FROM ap_map_event WHERE map_id = ${mapId}`)
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function sigCount(): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM ap_map_signature WHERE map_system_id IN (
        SELECT id FROM ap_map_system WHERE map_id = ${mapId}
      )`,
    )
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
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
    await db.delete(apMapEvent).where(eq(apMapEvent.mapId, mapId));
    await db.delete(apMap).where(eq(apMap.id, mapId));
  }
  await db.delete(apMap).where(eq(apMap.name, 'Bulk Paste Test Map'));
  await db
    .delete(universeWormhole)
    .where(inArray(universeWormhole.typeId, [TYPE_UNSTABLE, TYPE_GAS_BARREN]));
  await db
    .delete(universeType)
    .where(inArray(universeType.id, [TYPE_UNSTABLE, TYPE_GAS_BARREN]));
  await db
    .delete(universeGroup)
    .where(inArray(universeGroup.id, [GROUP_WORMHOLE, GROUP_GAS]));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYSTEM_A, SYSTEM_B]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
