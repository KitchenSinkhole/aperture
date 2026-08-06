// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapSystem,
  universeConstellation,
  universeRegion,
  universeSdeStage,
  universeStargateEdge,
  universeSystem,
} from '@/db/schema';
import { SdeGateError, syncSdeDeletions } from '@/lib/sde/ingest';

/**
 * DB-gated:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test sde-deletion-sync
 *
 * Run in isolation (RUN_DB_TESTS suites flake under parallelism). Every test
 * generates its own `randomUUID()` and stages a complete key set under it —
 * never a module-shared run id. `syncSdeDeletions` only ever reads/deletes
 * rows staged under the run id it's given, so even if one test's call is
 * still in flight past its own timeout (an unresolved JS promise keeps
 * running; vitest failing the test does not cancel it), a later test's
 * `seedStage` call under a *different* run id cannot race it: there is no
 * shared mutable state between runs for a lingering call to observe
 * half-written. Each seed stages the live tables minus this file's own
 * synthetic ids, so a run can only ever delete rows this file inserted —
 * safe against the non-pristine dev DB.
 *
 * Slower than most DB-gated tests: every `seedStage` call copies the ~645k-row
 * `universe_type_attribute` table into the stage (a pure server-side `INSERT
 * ... SELECT`, not a client round-trip, so this is fast in practice — under a
 * second — but the suite still carries explicit timeouts above the vitest
 * defaults for headroom).
 */
const run = process.env.RUN_DB_TESTS === '1';

const MAP_NAME = 'sde-deletion-sync-test-map';

const REGION_KEEP = 98150001;
const CONSTELLATION_KEEP = 98150001;
const SYS_RETAINED = 98150001;

const REGION_DELETE = 98150002;
const CONSTELLATION_DELETE = 98150002;
const SYS_DELETE = 98150002;

/** Every run id this file has staged, so `cleanup()` can sweep them all regardless of which test generated them. */
const usedRunIds: string[] = [];

function newRunId(): string {
  const id = randomUUID();
  usedRunIds.push(id);
  return id;
}

/**
 * Stages a complete key set for `runId`: the live tables minus whichever of
 * this file's own synthetic ids the caller is simulating as removed from the
 * build. `universe_category`/`universe_group`/`universe_dogma_attribute`/
 * `universe_type`/`universe_type_attribute` are always staged as "everything
 * live" — this suite never touches them.
 */
async function seedStage(
  runId: string,
  opts: {
    excludeSystems?: number[];
    excludeConstellations?: number[];
    excludeRegions?: number[];
    excludeEdges?: { from: number; to: number }[];
    skip?: 'universe_system';
  } = {},
): Promise<void> {
  await db.execute(sql`
    insert into universe_sde_stage (run_id, table_name, id_a)
    select ${runId}, 'universe_category', id from universe_category
  `);
  await db.execute(sql`
    insert into universe_sde_stage (run_id, table_name, id_a)
    select ${runId}, 'universe_group', id from universe_group
  `);
  await db.execute(sql`
    insert into universe_sde_stage (run_id, table_name, id_a)
    select ${runId}, 'universe_dogma_attribute', id from universe_dogma_attribute
  `);
  await db.execute(sql`
    insert into universe_sde_stage (run_id, table_name, id_a)
    select ${runId}, 'universe_type', id from universe_type
  `);
  await db.execute(sql`
    insert into universe_sde_stage (run_id, table_name, id_a, id_b)
    select ${runId}, 'universe_type_attribute', type_id, attribute_id from universe_type_attribute
  `);

  if (opts.skip !== 'universe_system') {
    const systems = await db.select({ id: universeSystem.id }).from(universeSystem);
    await stageIds(runId, 'universe_system', systems, opts.excludeSystems ?? []);
  }

  const constellations = await db.select({ id: universeConstellation.id }).from(universeConstellation);
  await stageIds(runId, 'universe_constellation', constellations, opts.excludeConstellations ?? []);

  const regions = await db.select({ id: universeRegion.id }).from(universeRegion);
  await stageIds(runId, 'universe_region', regions, opts.excludeRegions ?? []);

  const excludedEdgeKeys = new Set((opts.excludeEdges ?? []).map((e) => `${e.from}-${e.to}`));
  const edges = await db
    .select({ from: universeStargateEdge.fromSystemId, to: universeStargateEdge.toSystemId })
    .from(universeStargateEdge);
  const keptEdges = edges.filter((e) => !excludedEdgeKeys.has(`${e.from}-${e.to}`));
  if (keptEdges.length > 0) {
    await db.insert(universeSdeStage).values(
      keptEdges.map((e) => ({
        runId,
        tableName: 'universe_stargate_edge',
        idA: e.from,
        idB: e.to,
      })),
    );
  }
}

/** Stages `rows` minus `excludeIds` under `runId` for `tableName`. */
async function stageIds(
  runId: string,
  tableName: string,
  rows: { id: number }[],
  excludeIds: number[],
): Promise<void> {
  const excluded = new Set(excludeIds);
  const kept = rows.filter((r) => !excluded.has(r.id));
  if (kept.length === 0) return;
  await db.insert(universeSdeStage).values(kept.map((r) => ({ runId, tableName, idA: r.id, idB: null })));
}

async function cleanup() {
  if (usedRunIds.length > 0) {
    await db.delete(universeSdeStage).where(inArray(universeSdeStage.runId, usedRunIds));
  }
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(universeStargateEdge)
    .where(
      or(
        inArray(universeStargateEdge.fromSystemId, [SYS_RETAINED, SYS_DELETE]),
        inArray(universeStargateEdge.toSystemId, [SYS_RETAINED, SYS_DELETE]),
      ),
    );
  await db.delete(universeSystem).where(inArray(universeSystem.id, [SYS_RETAINED, SYS_DELETE]));
  await db
    .delete(universeConstellation)
    .where(inArray(universeConstellation.id, [CONSTELLATION_KEEP, CONSTELLATION_DELETE]));
  await db.delete(universeRegion).where(inArray(universeRegion.id, [REGION_KEEP, REGION_DELETE]));
}

describe.skipIf(!run)('SDE deletion sync (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values([
      { id: REGION_KEEP, name: 'Deletion Sync Test Region (kept)' },
      { id: REGION_DELETE, name: 'Deletion Sync Test Region (removed)' },
    ]);
    await db.insert(universeConstellation).values([
      { id: CONSTELLATION_KEEP, regionId: REGION_KEEP, name: 'Kept Constellation' },
      { id: CONSTELLATION_DELETE, regionId: REGION_DELETE, name: 'Removed Constellation' },
    ]);
    await db.insert(universeSystem).values([
      { id: SYS_RETAINED, constellationId: CONSTELLATION_KEEP, name: 'Retained System', security: 'H' },
      { id: SYS_DELETE, constellationId: CONSTELLATION_DELETE, name: 'Removed System', security: 'H' },
    ]);
    await db.insert(universeStargateEdge).values({ fromSystemId: SYS_RETAINED, toSystemId: SYS_DELETE });

    const [m] = await db
      .insert(apMap)
      .values({ scope: 'all', type: 'private', name: MAP_NAME })
      .returning({ id: apMap.id });
    await db.insert(apMapSystem).values({ mapId: m!.id, systemId: SYS_RETAINED, visible: true });
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it(
    'deletes a stargate edge absent from the new build unconditionally (no guard)',
    async () => {
      const runId = newRunId();
      await seedStage(runId, { excludeEdges: [{ from: SYS_RETAINED, to: SYS_DELETE }] });
      const report = await syncSdeDeletions(runId);
      expect(report.deleted.universe_stargate_edge).toBe(1);

      const rows = await db
        .select()
        .from(universeStargateEdge)
        .where(eq(universeStargateEdge.fromSystemId, SYS_RETAINED));
      expect(rows).toHaveLength(0);
    },
    15_000,
  );

  it(
    'retains a system referenced by ap_map_system and deletes an unreferenced one, with transitive retention up to region',
    async () => {
      const runId = newRunId();
      await seedStage(runId, {
        excludeSystems: [SYS_RETAINED, SYS_DELETE],
        excludeConstellations: [CONSTELLATION_KEEP, CONSTELLATION_DELETE],
        excludeRegions: [REGION_KEEP, REGION_DELETE],
      });
      const report = await syncSdeDeletions(runId);

      expect(report.retained.universe_system?.retained).toBe(1);
      expect(report.retained.universe_system?.ids).toContain(SYS_RETAINED);
      expect(report.retained.universe_constellation?.retained).toBe(1);
      expect(report.retained.universe_constellation?.ids).toContain(CONSTELLATION_KEEP);
      expect(report.retained.universe_region?.retained).toBe(1);
      expect(report.retained.universe_region?.ids).toContain(REGION_KEEP);

      expect(report.deleted.universe_system).toBe(1);
      expect(report.deleted.universe_constellation).toBe(1);
      expect(report.deleted.universe_region).toBe(1);

      const [retainedSystem] = await db.select().from(universeSystem).where(eq(universeSystem.id, SYS_RETAINED));
      expect(retainedSystem).toBeDefined();
      const [deletedSystem] = await db.select().from(universeSystem).where(eq(universeSystem.id, SYS_DELETE));
      expect(deletedSystem).toBeUndefined();

      const [keptConstellation] = await db
        .select()
        .from(universeConstellation)
        .where(eq(universeConstellation.id, CONSTELLATION_KEEP));
      expect(keptConstellation).toBeDefined();
      const [removedConstellation] = await db
        .select()
        .from(universeConstellation)
        .where(eq(universeConstellation.id, CONSTELLATION_DELETE));
      expect(removedConstellation).toBeUndefined();

      const [keptRegion] = await db.select().from(universeRegion).where(eq(universeRegion.id, REGION_KEEP));
      expect(keptRegion).toBeDefined();
      const [removedRegion] = await db.select().from(universeRegion).where(eq(universeRegion.id, REGION_DELETE));
      expect(removedRegion).toBeUndefined();
    },
    15_000,
  );

  it(
    'refuses to run with no staged keys for a covered table',
    async () => {
      const runId = newRunId();
      await seedStage(runId, { skip: 'universe_system' });
      await expect(syncSdeDeletions(runId)).rejects.toThrow(SdeGateError);
    },
    15_000,
  );
});
