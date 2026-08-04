// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapSystem,
  universeCategory,
  universeConstellation,
  universeDogmaAttribute,
  universeGroup,
  universeRegion,
  universeStargateEdge,
  universeSystem,
  universeType,
  universeTypeAttribute,
} from '@/db/schema';
import { SdeGateError, syncSdeDeletions, type SdeKeepSets } from '@/lib/sde/ingest';

/**
 * DB-gated:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test sde-deletion-sync
 *
 * Run in isolation (RUN_DB_TESTS suites flake under parallelism). Every
 * keep-set is built from the live tables minus this file's own synthetic ids,
 * so `syncSdeDeletions` can only ever touch rows this file inserted — safe
 * against the non-pristine dev DB. `universe_type`/`universe_category`/
 * `universe_group`/`universe_dogma_attribute`/`universe_type_attribute` are
 * left untouched throughout (their keep-sets are always "everything live");
 * only the region/constellation/system/stargate-edge chain is exercised.
 *
 * Noticeably slower than most DB-gated tests: `syncSdeDeletions` always walks
 * every SDE-derived table, including the ~645k-row `universe_type_attribute`.
 */
const run = process.env.RUN_DB_TESTS === '1';

const MAP_NAME = 'sde-deletion-sync-test-map';

const REGION_KEEP = 98150001;
const CONSTELLATION_KEEP = 98150001;
const SYS_RETAINED = 98150001;

const REGION_DELETE = 98150002;
const CONSTELLATION_DELETE = 98150002;
const SYS_DELETE = 98150002;

let baseline: Pick<SdeKeepSets, 'categories' | 'groups' | 'dogmaAttributes' | 'types' | 'typeAttributes'>;

async function loadBaseline() {
  const [categories, groups, dogmaAttributes, types, typeAttributes] = await Promise.all([
    db.select({ id: universeCategory.id }).from(universeCategory),
    db.select({ id: universeGroup.id }).from(universeGroup),
    db.select({ id: universeDogmaAttribute.id }).from(universeDogmaAttribute),
    db.select({ id: universeType.id }).from(universeType),
    db
      .select({ typeId: universeTypeAttribute.typeId, attributeId: universeTypeAttribute.attributeId })
      .from(universeTypeAttribute),
  ]);
  baseline = {
    categories: new Set(categories.map((r) => r.id)),
    groups: new Set(groups.map((r) => r.id)),
    dogmaAttributes: new Set(dogmaAttributes.map((r) => r.id)),
    types: new Set(types.map((r) => r.id)),
    typeAttributes: new Set(typeAttributes.map((r) => `${r.typeId}:${r.attributeId}`)),
  };
}

/** Live regions/constellations/systems/edges, minus whichever synthetic ids the caller is simulating as removed from the new build. */
async function liveKeepSets(opts: {
  excludeSystems?: number[];
  excludeConstellations?: number[];
  excludeRegions?: number[];
  excludeEdges?: { from: number; to: number }[];
} = {}): Promise<SdeKeepSets> {
  const [regions, constellations, systems, edges] = await Promise.all([
    db.select({ id: universeRegion.id }).from(universeRegion),
    db.select({ id: universeConstellation.id }).from(universeConstellation),
    db.select({ id: universeSystem.id }).from(universeSystem),
    db
      .select({ from: universeStargateEdge.fromSystemId, to: universeStargateEdge.toSystemId })
      .from(universeStargateEdge),
  ]);

  const excludedSystems = new Set(opts.excludeSystems ?? []);
  const excludedConstellations = new Set(opts.excludeConstellations ?? []);
  const excludedRegions = new Set(opts.excludeRegions ?? []);
  const excludedEdgeKeys = new Set((opts.excludeEdges ?? []).map((e) => `${e.from}-${e.to}`));

  return {
    ...baseline,
    regions: new Set(regions.map((r) => r.id).filter((id) => !excludedRegions.has(id))),
    constellations: new Set(constellations.map((r) => r.id).filter((id) => !excludedConstellations.has(id))),
    systems: new Set(systems.map((r) => r.id).filter((id) => !excludedSystems.has(id))),
    stargateEdges: new Set(edges.map((r) => `${r.from}-${r.to}`).filter((key) => !excludedEdgeKeys.has(key))),
  };
}

async function cleanup() {
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

    await loadBaseline();
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('deletes a stargate edge absent from the new build unconditionally (no guard)', async () => {
    const keep = await liveKeepSets({ excludeEdges: [{ from: SYS_RETAINED, to: SYS_DELETE }] });
    const report = await syncSdeDeletions(keep);
    expect(report.deleted.universe_stargate_edge).toBe(1);

    const rows = await db
      .select()
      .from(universeStargateEdge)
      .where(eq(universeStargateEdge.fromSystemId, SYS_RETAINED));
    expect(rows).toHaveLength(0);
  });

  it('retains a system referenced by ap_map_system and deletes an unreferenced one, with transitive retention up to region', async () => {
    const keep = await liveKeepSets({
      excludeSystems: [SYS_RETAINED, SYS_DELETE],
      excludeConstellations: [CONSTELLATION_KEEP, CONSTELLATION_DELETE],
      excludeRegions: [REGION_KEEP, REGION_DELETE],
    });
    const report = await syncSdeDeletions(keep);

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
  });

  it('refuses to run against an empty keep-set', async () => {
    const keep = await liveKeepSets();
    keep.systems = new Set();
    await expect(syncSdeDeletions(keep)).rejects.toThrow(SdeGateError);
  });
});
