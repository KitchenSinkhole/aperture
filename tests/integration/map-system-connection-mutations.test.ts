// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapConnection,
  apMapSystem,
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
import {
  addSystem,
  addSystemWithStargateLinks,
  removeSystem,
  updateSystem,
} from '@/lib/map/mutations/systems';
import {
  createConnection,
  deleteConnection,
  updateConnection,
} from '@/lib/map/mutations/connections';
import { createSignature } from '@/lib/map/mutations/signatures';
import { loadSignaturesForSystems } from '@/lib/map/systemNode';
import { staticMatchForConnection, wormholeTypesForSystem } from '@/lib/map/wormholeTypes';
import { mapEventPayloadSchema } from '@/lib/realtime/protocol';

/**
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 *
 * Drives each system/connection helper against real Postgres and asserts row
 * state + exactly one `ap_map_event` per call + payload shape, and checks the
 * wormhole-catalog filters return class-correct codes (incl. the K162 universal).
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98030001;
const CONSTELLATION = 98030001;
const C3 = 98030003; // a C3 wormhole system (security label 'C3')
const HS = 98030004; // a high-sec system (security label 'H')
const KS1 = 98030005; // a K-space system gate-linked to KS2
const KS2 = 98030006; // a K-space system gate-linked to KS1
const CATEGORY = 98030001;
const GROUP = 98030001;
// Wormhole catalog rows:
const WH_C3_HS = 98030010; // source C3 → target H  (a C3 system's static into hi-sec)
const WH_K162 = 98030011; // K162 universal: source NULL, target NULL
const WH_C5 = 98030012; // source C5 → should NOT appear for a C3 system

let mapId = 0n;

describe.skipIf(!run)('system & connection mutations (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'Mut Test Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Mut Test Const' });
    await db.insert(universeSystem).values([
      { id: C3, constellationId: CONSTELLATION, name: 'J130003', security: 'C3' },
      { id: HS, constellationId: CONSTELLATION, name: 'Mut HS', security: 'H' },
      { id: KS1, constellationId: CONSTELLATION, name: 'Mut KS1', security: 'H' },
      { id: KS2, constellationId: CONSTELLATION, name: 'Mut KS2', security: 'H' },
    ]);
    // KS1 ↔ KS2 share an in-game stargate (SDE mirrors both directions).
    await db.insert(universeStargateEdge).values([
      { fromSystemId: KS1, toSystemId: KS2 },
      { fromSystemId: KS2, toSystemId: KS1 },
    ]);

    await db.insert(universeCategory).values({ id: CATEGORY, name: 'Mut Cat' });
    await db.insert(universeGroup).values({ id: GROUP, categoryId: CATEGORY, name: 'Mut Grp' });
    await db.insert(universeType).values([
      { id: WH_C3_HS, groupId: GROUP, name: 'WH C3HS' },
      { id: WH_K162, groupId: GROUP, name: 'WH K162' },
      { id: WH_C5, groupId: GROUP, name: 'WH C5' },
    ]);
    await db.insert(universeWormhole).values([
      { typeId: WH_C3_HS, name: 'X877', sourceClasses: ['C3'], targetClass: 'H' },
      { typeId: WH_K162, name: 'K162', sourceClasses: null, targetClass: null },
      { typeId: WH_C5, name: 'M555', sourceClasses: ['C5'], targetClass: 'C3' },
    ]);
    // The C3 system has a static (X877) leading to hi-sec.
    await db.insert(universeSystemStatic).values({ systemId: C3, typeId: WH_C3_HS });

    const [map] = await db
      .insert(apMap)
      .values({ name: 'Mut Test Map', scope: 'all', type: 'private' })
      .returning({ id: apMap.id });
    mapId = map!.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('addSystem inserts a visible row and emits one system.added event', async () => {
    const before = await eventCount();
    const result = await addSystem({ mapId, systemId: C3, characterId: null, positionX: 5, positionY: 7 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => mapEventPayloadSchema.parse(result.data)).not.toThrow();
    // `statics` carries far-side target-class labels (systemNode resolves
    // targetClass ?? code); X877 leads to hi-sec, so the class is 'H'.
    expect(result.data).toMatchObject({ kind: 'system.added', systemId: C3, statics: ['H'] });
    expect(await eventCount()).toBe(before + 1);

    const [row] = await db
      .select({ visible: apMapSystem.visible, posX: apMapSystem.positionX })
      .from(apMapSystem)
      .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, C3)));
    expect(row).toMatchObject({ visible: true, posX: 5 });
  });

  it('updateSystem writes only the patched fields and echoes them', async () => {
    const sysId = await mapSystemId(C3);
    const result = await updateSystem({
      mapId,
      mapSystemId: sysId,
      characterId: null,
      patch: { status: 'hostile', alias: 'Home', locked: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      kind: 'system.updated',
      eventId: result.eventId,
      id: sysId.toString(),
      status: 'hostile',
      alias: 'Home',
      locked: true,
    });

    const [row] = await db
      .select({ status: apMapSystem.status, alias: apMapSystem.alias, locked: apMapSystem.locked })
      .from(apMapSystem)
      .where(eq(apMapSystem.id, sysId));
    expect(row).toMatchObject({ status: 'hostile', alias: 'Home', locked: true });
  });

  it('removeSystem flips visible=false (row persists) then re-add preserves intel', async () => {
    const sysId = await mapSystemId(C3);

    const removed = await removeSystem({ mapId, mapSystemId: sysId, characterId: null });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.data).toEqual({ kind: 'system.removed', eventId: removed.eventId, id: sysId.toString() });
    const [hidden] = await db
      .select({ visible: apMapSystem.visible, alias: apMapSystem.alias })
      .from(apMapSystem)
      .where(eq(apMapSystem.id, sysId));
    expect(hidden).toMatchObject({ visible: false, alias: 'Home' });

    // Re-add reuses the same row: visible flips back, alias survives.
    const readded = await addSystem({ mapId, systemId: C3, characterId: null });
    expect(readded.ok).toBe(true);
    if (!readded.ok) return;
    expect(readded.data).toMatchObject({ kind: 'system.added', id: sysId.toString(), alias: 'Home' });
    const rows = await db
      .select({ id: apMapSystem.id })
      .from(apMapSystem)
      .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, C3)));
    expect(rows).toHaveLength(1); // no duplicate row
  });

  it('re-adding a system carries no signatures on the event; survivors hydrate via the loader', async () => {
    // Ensure C3 is placed, then hang a signature off it.
    await addSystem({ mapId, systemId: C3, characterId: null });
    const sysId = await mapSystemId(C3);
    const sig = await createSignature({
      mapId,
      mapSystemId: sysId,
      characterId: null,
      sigId: 'ABC-123',
      groupKey: 'wormhole',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(sig.ok).toBe(true);

    // Soft-remove then re-add: the signature row survives the visible=false cycle.
    const removed = await removeSystem({ mapId, mapSystemId: sysId, characterId: null });
    expect(removed.ok).toBe(true);
    const readded = await addSystem({ mapId, systemId: C3, characterId: null });
    expect(readded.ok).toBe(true);
    if (!readded.ok) return;

    // The event is a pure node-body delta — signatures do NOT ride it (embedding
    // them breached the 8 KB pg_notify ceiling and rolled the insert back).
    expect(readded.data).toMatchObject({ kind: 'system.added', id: sysId.toString() });
    expect('signatures' in (readded.data as Record<string, unknown>)).toBe(false);

    // The surviving sig is served by the shared loader the hydration endpoint uses.
    const sigs = await loadSignaturesForSystems([sysId]);
    expect(sigs.map((s) => s.sigId)).toContain('ABC-123');
  });

  it('createConnection / updateConnection (EOL) / deleteConnection round-trip', async () => {
    const sourceId = await mapSystemId(C3);
    const targetRes = await addSystem({ mapId, systemId: HS, characterId: null });
    expect(targetRes.ok).toBe(true);
    const targetId = await mapSystemId(HS);

    const created = await createConnection({
      mapId,
      characterId: null,
      sourceMapSystemId: sourceId,
      targetMapSystemId: targetId,
      scope: 'wh',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data).toMatchObject({
      kind: 'connection.create',
      source: sourceId.toString(),
      target: targetId.toString(),
      scope: 'wh',
      massStatus: 'fresh',
      eolStage: 'none',
    });
    const connId = BigInt((created.data as { id: string }).id);

    const eolBefore = await eventCount();
    const updated = await updateConnection({
      mapId,
      connectionId: connId,
      characterId: null,
      patch: { eolStage: 'critical', massStatus: 'critical' },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data).toMatchObject({
      kind: 'connection.update',
      eolStage: 'critical',
      massStatus: 'critical',
    });
    expect((updated.data as { eolAt: string }).eolAt).toBeTruthy();
    expect(await eventCount()).toBe(eolBefore + 1);
    const [conn] = await db
      .select({ eolStage: apMapConnection.eolStage, eolAt: apMapConnection.eolAt })
      .from(apMapConnection)
      .where(eq(apMapConnection.id, connId));
    expect(conn!.eolStage).toBe('critical');
    expect(conn!.eolAt).toBeInstanceOf(Date);

    const deleted = await deleteConnection({ mapId, connectionId: connId, characterId: null });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data).toEqual({
      kind: 'connection.delete',
      eventId: deleted.eventId,
      id: connId.toString(),
      source: sourceId.toString(),
      target: targetId.toString(),
    });
    const remaining = await db
      .select({ id: apMapConnection.id })
      .from(apMapConnection)
      .where(eq(apMapConnection.id, connId));
    expect(remaining).toHaveLength(0); // hard delete
  });

  it('wormholeTypesForSystem returns the full catalog annotated with matchesClass', async () => {
    // The full catalog is returned now (the client splits matched vs. "show all"),
    // so assert the matchesClass rule rather than a filtered set. The real seeded
    // catalog is present too, which lets us pin the user-reported leak cases.
    const types = await wormholeTypesForSystem(C3);
    // Key our fixtures by typeId — the seeded catalog has real rows that reuse
    // the codes X877 / M555 (different classes), so a name key would collide.
    const byId = new Map(types.map((t) => [t.typeId, t]));
    const byName = new Map(types.map((t) => [t.name, t]));

    expect(byId.get(WH_C3_HS)?.matchesClass).toBe(true); // C3-source (and a C3 static)
    expect(byId.get(WH_C3_HS)?.isStatic).toBe(true);
    expect(byId.get(WH_K162)?.matchesClass).toBe(true); // null-source universal
    expect(byId.get(WH_C5)?.matchesClass).toBe(false); // C5-source — not a C3 match

    // The over-inclusion the change fixes: k-space-sourced holes must not match
    // a C3 system (they were previously offered everywhere via a null source).
    expect(byName.get('R943')?.matchesClass).toBe(false); // {H,L,0.0} → C2
    expect(byName.get('S199')?.matchesClass).toBe(false); // {L,0.0} → 0.0

    // Every class-matched, non-static row is null-source or contains C3.
    for (const t of types) {
      if (t.matchesClass && !t.isStatic) {
        expect(t.sourceClasses === null || t.sourceClasses.includes('C3')).toBe(true);
      }
    }
  });

  it('staticMatchForConnection matches the source system static by target class', async () => {
    const matches = await staticMatchForConnection({ sourceSystemId: C3, targetSystemId: HS });
    expect(matches).toEqual([{ typeId: WH_C3_HS, name: 'X877', targetClass: 'H' }]);

    // C3→C3 has no matching static.
    const none = await staticMatchForConnection({ sourceSystemId: C3, targetSystemId: C3 });
    expect(none).toEqual([]);
  });

  it('addSystemWithStargateLinks auto-links gate-adjacent systems and never duplicates', async () => {
    // First system on a (gate-wise) empty map: no neighbours yet → just the add.
    const first = await addSystemWithStargateLinks({ mapId, systemId: KS1, characterId: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.payloads).toHaveLength(1);
    expect(first.data.payloads[0]).toMatchObject({ kind: 'system.added', systemId: KS1 });

    // Second system shares a stargate with KS1 → one auto `stargate` connection.
    const second = await addSystemWithStargateLinks({ mapId, systemId: KS2, characterId: null });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.payloads).toHaveLength(2);
    expect(second.data.payloads[0]).toMatchObject({ kind: 'system.added', systemId: KS2 });
    expect(second.data.payloads[1]).toMatchObject({ kind: 'connection.create', scope: 'stargate' });

    const ks1Id = await mapSystemId(KS1);
    const ks2Id = await mapSystemId(KS2);
    const gateLinks = await db
      .select({ id: apMapConnection.id })
      .from(apMapConnection)
      .where(and(eq(apMapConnection.mapId, mapId), eq(apMapConnection.scope, 'stargate')));
    expect(gateLinks).toHaveLength(1);
    expect(second.data.payloads[1]).toMatchObject({
      source: ks2Id.toString(),
      target: ks1Id.toString(),
    });

    // Re-adding KS2 must not create a second gate link (the row persists across
    // a soft-remove, so the dedup query finds the existing one).
    await removeSystem({ mapId, mapSystemId: ks2Id, characterId: null });
    const readd = await addSystemWithStargateLinks({ mapId, systemId: KS2, characterId: null });
    expect(readd.ok).toBe(true);
    if (!readd.ok) return;
    expect(readd.data.payloads).toHaveLength(1); // just the re-add, no new link
    const after = await db
      .select({ id: apMapConnection.id })
      .from(apMapConnection)
      .where(and(eq(apMapConnection.mapId, mapId), eq(apMapConnection.scope, 'stargate')));
    expect(after).toHaveLength(1);
  });
});

async function eventCount(): Promise<number> {
  const rows = (
    await db.execute(sql`SELECT count(*)::int AS count FROM ap_map_event WHERE map_id = ${mapId}`)
  ).rows as Array<{ count: number }>;
  return rows[0]!.count;
}

async function mapSystemId(systemId: number): Promise<bigint> {
  const [row] = await db
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, systemId)));
  return row!.id;
}

async function cleanup() {
  if (mapId) await db.delete(apMap).where(eq(apMap.id, mapId));
  await db.delete(apMap).where(eq(apMap.name, 'Mut Test Map'));
  await db.delete(universeSystemStatic).where(eq(universeSystemStatic.systemId, C3));
  await db
    .delete(universeWormhole)
    .where(inArray(universeWormhole.typeId, [WH_C3_HS, WH_K162, WH_C5]));
  await db.delete(universeType).where(inArray(universeType.id, [WH_C3_HS, WH_K162, WH_C5]));
  await db.delete(universeGroup).where(eq(universeGroup.id, GROUP));
  await db.delete(universeCategory).where(eq(universeCategory.id, CATEGORY));
  await db
    .delete(universeStargateEdge)
    .where(inArray(universeStargateEdge.fromSystemId, [KS1, KS2]));
  await db.delete(universeSystem).where(inArray(universeSystem.id, [C3, HS, KS1, KS2]));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
