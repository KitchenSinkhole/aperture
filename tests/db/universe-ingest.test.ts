// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { SDE_BUILD } from '@/lib/sde/ingest';
import { apertureConfig } from '../../aperture.config';

/**
 * Requires a migrated DB populated by `pnpm sde:bootstrap`
 * against the pinned SDE build. Gated behind RUN_DB_TESTS so the default fast
 * `pnpm test` lane stays offline.
 *
 *   pnpm db:migrate && pnpm sde:bootstrap && RUN_DB_TESTS=1 pnpm test
 *
 * Thresholds are pinned lower bounds for build SDE_BUILD, not an exact count.
 */
const run = process.env.RUN_DB_TESTS === '1';

async function count(table: string): Promise<number> {
  const res = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
  return (res.rows[0] as { n: number }).n;
}

async function scalar<T>(query: ReturnType<typeof sql>): Promise<T> {
  const res = await db.execute(query);
  return res.rows[0] as T;
}

describe.skipIf(!run)(`universe ingest gate (SDE build ${SDE_BUILD})`, () => {
  afterAll(async () => {
    await pool.end();
  });

  it('meets pinned lower-bound row counts', async () => {
    expect(await count('universe_region')).toBeGreaterThanOrEqual(110);
    expect(await count('universe_constellation')).toBeGreaterThanOrEqual(1100);
    expect(await count('universe_system')).toBeGreaterThanOrEqual(8200);
    expect(await count('universe_category')).toBeGreaterThanOrEqual(40);
    expect(await count('universe_group')).toBeGreaterThanOrEqual(1000);
    expect(await count('universe_type')).toBeGreaterThanOrEqual(40000);
    expect(await count('universe_dogma_attribute')).toBeGreaterThanOrEqual(2000);
    expect(await count('universe_type_attribute')).toBeGreaterThanOrEqual(500000);
    expect(await count('universe_stargate_edge')).toBeGreaterThanOrEqual(13000);
    expect(await count('universe_type_override')).toBeGreaterThanOrEqual(55);
  });

  it('has no orphaned references', async () => {
    const orphanEdges = await scalar<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM universe_stargate_edge e
      LEFT JOIN universe_system a ON a.id = e.from_system_id
      LEFT JOIN universe_system b ON b.id = e.to_system_id
      WHERE a.id IS NULL OR b.id IS NULL`);
    expect(orphanEdges.n).toBe(0);

    const orphanAttrs = await scalar<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM universe_type_attribute ta
      LEFT JOIN universe_type t ON t.id = ta.type_id
      WHERE t.id IS NULL`);
    expect(orphanAttrs.n).toBe(0);
  });

  it('resolves known system fixtures with correct security labels', async () => {
    const rows = await db.execute(sql`
      SELECT id, name, security FROM universe_system
      WHERE id IN (30000142, 30000144, 31000005, 31000007, 30000021, 32000001)
      ORDER BY id`);
    const byId = new Map(
      (rows.rows as { id: number; name: string; security: string }[]).map((r) => [r.id, r]),
    );
    expect(byId.get(30000142)).toMatchObject({ name: 'Jita', security: 'H' });
    expect(byId.get(30000144)?.name).toBe('Perimeter');
    expect(byId.get(31000005)?.name).toBe('Thera');
    expect(byId.get(31000005)?.security).toMatch(/^C/);
    expect(byId.get(31000007)?.security).toBe('C1'); // J105443
    expect(byId.get(30000021)?.security).toBe('P'); // Pochven
    expect(byId.get(32000001)?.security).toBe('A'); // Abyssal
  });

  it('samples 100 systems and finds names + neighbours for k-space', async () => {
    const sample = await db.execute(sql`
      SELECT s.id, s.name, s.security,
        (SELECT count(*)::int FROM universe_stargate_edge e WHERE e.from_system_id = s.id) AS deg
      FROM universe_system s ORDER BY s.id LIMIT 100`);
    const rows = sample.rows as { id: number; name: string; security: string; deg: number }[];
    expect(rows).toHaveLength(100);
    for (const r of rows) expect(r.name.length).toBeGreaterThan(0);
    // The first 100 system ids are k-space (30000001+); each should have neighbours.
    expect(rows.every((r) => r.deg > 0)).toBe(true);
  });

  it('confirms Jita↔Perimeter adjacency and a multi-hop route', async () => {
    const adj = await scalar<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM universe_stargate_edge
      WHERE (from_system_id = 30000142 AND to_system_id = 30000144)
         OR (from_system_id = 30000144 AND to_system_id = 30000142)`);
    expect(adj.n).toBe(2);

    // BFS reachability from Jita up to 5 hops (UNION dedups (sid,hops) pairs).
    const route = await scalar<{ reachable: number; maxhops: number }>(sql`
      WITH RECURSIVE r(sid, hops) AS (
        SELECT 30000142, 0
        UNION
        SELECT e.to_system_id, r.hops + 1
        FROM r JOIN universe_stargate_edge e ON e.from_system_id = r.sid
        WHERE r.hops < 5
      )
      SELECT count(DISTINCT sid)::int AS reachable, max(hops)::int AS maxhops FROM r`);
    expect(route.maxhops).toBe(5);
    expect(route.reachable).toBeGreaterThan(50);
  });

  it('badges Perimeter as 1 jump from Jita', async () => {
    const row = await scalar<{ hub: number; jumps: number }>(sql`
      SELECT nearest_trade_hub_id AS hub, nearest_trade_hub_jumps AS jumps
      FROM universe_system WHERE id = 30000144`); // Perimeter
    expect(row.hub).toBe(30000142); // Jita
    expect(row.jumps).toBe(1);
  });

  it('leaves hub systems and non-HS systems unbadged', async () => {
    // Jita itself is distance 0 from a hub → excluded.
    const jita = await scalar<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM universe_system
      WHERE id = 30000142 AND nearest_trade_hub_id IS NULL`);
    expect(jita.n).toBe(1);

    // Only high-sec systems ever get a hub.
    const nonHs = await scalar<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM universe_system
      WHERE nearest_trade_hub_id IS NOT NULL AND security <> 'H'`);
    expect(nonHs.n).toBe(0);
  });

  it('respects per-hub thresholds and valid hub ids', async () => {
    const rows = await db.execute(sql`
      SELECT nearest_trade_hub_id AS hub, nearest_trade_hub_jumps AS jumps
      FROM universe_system WHERE nearest_trade_hub_id IS NOT NULL`);
    const thresholds = new Map<number, number>(
      apertureConfig.ROUTE_HUBS.map((h) => [h.systemId, h.proximityJumps]),
    );
    const assigned = rows.rows as { hub: number; jumps: number }[];
    expect(assigned.length).toBeGreaterThan(0);
    for (const r of assigned) {
      const threshold = thresholds.get(r.hub);
      expect(threshold).toBeDefined();
      expect(r.jumps).toBeGreaterThanOrEqual(1);
      expect(r.jumps).toBeLessThanOrEqual(threshold!);
    }
  });

  it('routes to Jita strictly through high-sec', async () => {
    // HS-only BFS from Jita: every hop must land on an HS system, so by
    // induction the whole path (incl. both endpoints) is HS. Stored distances
    // for Jita-assigned systems must equal this — a route dipping through
    // low/null-sec would give a different (or no) distance.
    const result = await scalar<{ mismatches: number; unreachable: number }>(sql`
      WITH RECURSIVE r(sid, hops) AS (
        SELECT 30000142, 0
        UNION
        SELECT e.to_system_id, r.hops + 1
        FROM r
        JOIN universe_stargate_edge e ON e.from_system_id = r.sid
        JOIN universe_system hs ON hs.id = e.to_system_id AND hs.security = 'H'
        WHERE r.hops < 10
      ),
      hs_dist AS (SELECT sid, min(hops) AS hops FROM r GROUP BY sid)
      SELECT
        count(*) FILTER (
          WHERE d.sid IS NOT NULL AND s.nearest_trade_hub_jumps <> d.hops
        )::int AS mismatches,
        count(*) FILTER (WHERE d.sid IS NULL)::int AS unreachable
      FROM universe_system s
      LEFT JOIN hs_dist d ON d.sid = s.id
      WHERE s.nearest_trade_hub_id = 30000142`);
    expect(result.mismatches).toBe(0);
    expect(result.unreachable).toBe(0);
  });

  it('honors attr-3974 overrides through the effective view', async () => {
    // Wormhole A239 (type 30678) has a CSV override of 5 for attr 3974.
    const ov = await scalar<{ value: number }>(sql`
      SELECT value FROM universe_type_attribute_effective
      WHERE type_id = 30678 AND attr_id = 3974`);
    expect(ov.value).toBe(5);
  });

  // The WH catalog's source_classes/target_class must use the same vocabulary as
  // universe_system.security (the join key for "leads to" / "mark as static" /
  // WH-type suggestion). Thera (class 12) derives to `C12`, so a hole leading to
  // Thera (e.g. F135) must carry target_class = `C12`, not the literal `Thera`.
  it('catalog class tokens match universe_system.security for Thera (F135 leads to C12)', async () => {
    const row = await scalar<{ targetClass: string | null; theraSecurity: string | null }>(sql`
      SELECT
        (SELECT target_class FROM universe_wormhole WHERE name = 'F135') AS "targetClass",
        (SELECT security FROM universe_system WHERE id = 31000005) AS "theraSecurity"`);
    // Thera's derived class drives the expectation, so this is robust to the exact label.
    expect(row.theraSecurity).toBe('C12');
    expect(row.targetClass).toBe(row.theraSecurity);

    // No catalog row may use the Pathfinder-era literal `Thera` token in either column.
    const stray = await scalar<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM universe_wormhole
      WHERE target_class = 'Thera' OR 'Thera' = ANY(source_classes)`);
    expect(stray.n).toBe(0);
  });

  // The five Drifter holes open into a Drifter system but spawn k-space-side, only
  // in systems with a Jove Observatory. That presence isn't in the SDE, so their
  // source is broadened to the full k-space set (H/L/0.0) rather than left null —
  // a null source would offer them everywhere (incl. J-space) via the class filter.
  it('scopes the Drifter holes to k-space source classes', async () => {
    const rows = await db.execute(sql`
      SELECT name, source_classes AS "sourceClasses", target_class AS "targetClass"
      FROM universe_wormhole
      WHERE name IN ('B735', 'C414', 'R259', 'S877', 'V928')
      ORDER BY name`);
    const drifters = rows.rows as { name: string; sourceClasses: string[] | null; targetClass: string | null }[];
    expect(drifters.map((r) => r.name)).toEqual(['B735', 'C414', 'R259', 'S877', 'V928']);
    for (const r of drifters) {
      expect([...(r.sourceClasses ?? [])].sort()).toEqual(['0.0', 'H', 'L']);
      // Drifter destination classes (C14–C18) aren't in Aperture's vocabulary.
      expect(r.targetClass).toBeNull();
    }
  });
});
