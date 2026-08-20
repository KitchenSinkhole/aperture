// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapSystem,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import { addSystem, removeSystem, updateSystem } from '@/lib/map/mutations/systems';
import { foldJumpOntoMap } from '@/lib/jobs/locationCommit';
import { canManageMap } from '@/lib/auth/rights';

/**
 * Per-map auto-tagging (ABC + 0121).
 *
 * Verifies, against real Postgres, that ABC assigns/reclaims per-class letters
 * at add time, that 0121 numbers a chain off Home at connect time (via the
 * location-poll fold), that the Home system can't be removed while designated,
 * that a no-scheme map leaves tags untouched, and that the owner/admin gate
 * holds.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test auto-tagging
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 98044001;
const CONSTELLATION = 98044001;

// ABC map systems (C1 unless noted).
const C1_A = 98044010;
const C1_B = 98044011;
const C1_C = 98044012;
const C1_D = 98044013;
const C1_E = 98044014;
const C2_A = 98044015;
// 0121 map systems.
const HOME_SYS = 98044020;
const S1 = 98044021;
const S2 = 98044022;
const S3 = 98044023;
const S4 = 98044024;
const S5 = 98044025;
// none-scheme map system.
const N1 = 98044030;

const ALL_SYSTEMS = [C1_A, C1_B, C1_C, C1_D, C1_E, C2_A, HOME_SYS, S1, S2, S3, S4, S5, N1];

const OWNER_ID = 98044901n;
const STRANGER_ID = 98044902n;
const OWNER_CORP = 98044801n;
const STRANGER_CORP = 98044802n;

const ABC_MAP = 'AutoTag ABC Map';
const CHAIN_MAP = 'AutoTag 0121 Map';
const NONE_MAP = 'AutoTag None Map';

let ownerUserId = 0;
let strangerUserId = 0;
let abcMapId = 0n;
let chainMapId = 0n;
let noneMapId = 0n;

/** The `tag` currently on a (map, eve-system) row. */
async function tagOf(mapId: bigint, systemId: number): Promise<string | null> {
  const [row] = await db
    .select({ tag: apMapSystem.tag })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, systemId)));
  return row?.tag ?? null;
}

/** The `ap_map_system.id` of a (map, eve-system) row. */
async function mapSystemId(mapId: bigint, systemId: number): Promise<bigint> {
  const [row] = await db
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.mapId, mapId), eq(apMapSystem.systemId, systemId)));
  return row!.id;
}

async function addOk(mapId: bigint, systemId: number): Promise<{ id: string; tag: string | null }> {
  const res = await addSystem({ mapId, systemId, characterId: null });
  expect(res.ok).toBe(true);
  const data = (res as { ok: true; data: { id: string; tag: string | null } }).data;
  return data;
}

describe.skipIf(!run)('Stage 17.10 — auto-tagging (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    await db.insert(universeRegion).values({ id: REGION, name: 'AutoTag Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'AutoTag Const' });
    await db.insert(universeSystem).values(
      ALL_SYSTEMS.map((id) => ({
        id,
        constellationId: CONSTELLATION,
        name: `J${id}`,
        // C2_A is class 2; everything else class 1 or 3 — only the label matters.
        security: id === C2_A ? 'C2' : id >= HOME_SYS ? 'C3' : 'C1',
      })),
    );

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    ownerUserId = u!.id;
    const [su] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    strangerUserId = su!.id;
    await db.insert(apCharacter).values([
      mkChar(OWNER_ID, 'Tag Owner', ownerUserId, OWNER_CORP),
      mkChar(STRANGER_ID, 'Tag Stranger', strangerUserId, STRANGER_CORP),
    ]);

    const maps = await db
      .insert(apMap)
      .values([
        { name: ABC_MAP, scope: 'wh', type: 'private', ownerCharacterId: OWNER_ID, tagScheme: 'abc' },
        { name: CHAIN_MAP, scope: 'wh', type: 'private', ownerCharacterId: OWNER_ID, tagScheme: '0121' },
        { name: NONE_MAP, scope: 'wh', type: 'private', ownerCharacterId: OWNER_ID },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    abcMapId = maps.find((m) => m.name === ABC_MAP)!.id;
    chainMapId = maps.find((m) => m.name === CHAIN_MAP)!.id;
    noneMapId = maps.find((m) => m.name === NONE_MAP)!.id;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('ABC: assigns per-class letters, reclaims, and recomputes on re-add', async () => {
    expect((await addOk(abcMapId, C1_A)).tag).toBe('A');
    expect((await addOk(abcMapId, C1_B)).tag).toBe('B');
    expect((await addOk(abcMapId, C1_C)).tag).toBe('C');
    // C2 keeps an independent sequence.
    expect((await addOk(abcMapId, C2_A)).tag).toBe('A');

    // Remove B → the next C1 reclaims B (lowest free), not D.
    const removeB = await removeSystem({
      mapId: abcMapId,
      mapSystemId: await mapSystemId(abcMapId, C1_B),
      characterId: null,
    });
    expect(removeB.ok).toBe(true);
    expect((await addOk(abcMapId, C1_D)).tag).toBe('B');

    // Remove A, add E (reclaims A), then re-add A (its old tag is recomputed, not preserved).
    await removeSystem({
      mapId: abcMapId,
      mapSystemId: await mapSystemId(abcMapId, C1_A),
      characterId: null,
    });
    expect((await addOk(abcMapId, C1_E)).tag).toBe('A');
    // C1 letters now in use by others: A(E) B(D) C(C). Re-adding the old 'A' system → D.
    expect((await addOk(abcMapId, C1_A)).tag).toBe('D');
  });

  it('0121: numbers a chain off Home via the location-poll fold and reclaims per-parent', async () => {
    // Place + designate Home, then build the chain by simulated jumps.
    await addOk(chainMapId, HOME_SYS);
    const homeMapSystemId = await mapSystemId(chainMapId, HOME_SYS);
    await db.update(apMap).set({ homeMapSystemId }).where(eq(apMap.id, chainMapId));

    await foldJumpOntoMap({ mapId: chainMapId, characterId: OWNER_ID, fromSystemId: HOME_SYS, toSystemId: S1, addNewSystems: true, scope: 'wh' });
    expect(await tagOf(chainMapId, S1)).toBe('1');

    await foldJumpOntoMap({ mapId: chainMapId, characterId: OWNER_ID, fromSystemId: S1, toSystemId: S2, addNewSystems: true, scope: 'wh' });
    expect(await tagOf(chainMapId, S2)).toBe('11');

    await foldJumpOntoMap({ mapId: chainMapId, characterId: OWNER_ID, fromSystemId: S1, toSystemId: S3, addNewSystems: true, scope: 'wh' });
    expect(await tagOf(chainMapId, S3)).toBe('12');

    await foldJumpOntoMap({ mapId: chainMapId, characterId: OWNER_ID, fromSystemId: S2, toSystemId: S4, addNewSystems: true, scope: 'wh' });
    expect(await tagOf(chainMapId, S4)).toBe('111');

    // Remove 11 (S2); the next child off 1 reclaims 11.
    await removeSystem({
      mapId: chainMapId,
      mapSystemId: await mapSystemId(chainMapId, S2),
      characterId: null,
    });
    await foldJumpOntoMap({ mapId: chainMapId, characterId: OWNER_ID, fromSystemId: S1, toSystemId: S5, addNewSystems: true, scope: 'wh' });
    expect(await tagOf(chainMapId, S5)).toBe('11');
  });

  it('rejects removing the designated Home system', async () => {
    const homeMapSystemId = await mapSystemId(chainMapId, HOME_SYS);
    const res = await removeSystem({ mapId: chainMapId, mapSystemId: homeMapSystemId, characterId: null });
    expect(res.ok).toBe(false);
    expect((res as { ok: false; error: string }).error).toMatch(/Home/);
    // A non-Home system still removes fine.
    const ok = await removeSystem({
      mapId: chainMapId,
      mapSystemId: await mapSystemId(chainMapId, S3),
      characterId: null,
    });
    expect(ok.ok).toBe(true);
  });

  it('scheme=none leaves tags untouched and preserves a manual tag on re-add', async () => {
    expect((await addOk(noneMapId, N1)).tag).toBeNull();
    const n1 = await mapSystemId(noneMapId, N1);
    await updateSystem({ mapId: noneMapId, mapSystemId: n1, characterId: null, patch: { tag: 'X' } });
    await removeSystem({ mapId: noneMapId, mapSystemId: n1, characterId: null });
    // Re-add: no scheme → the preserved manual tag survives.
    expect((await addOk(noneMapId, N1)).tag).toBe('X');
  });

  it('manage gate: only a manager of the map may configure tagging', async () => {
    expect(await canManageMap(OWNER_ID, abcMapId)).toBe(true);
    expect(await canManageMap(STRANGER_ID, abcMapId)).toBe(false);
  });
});

function mkChar(id: bigint, name: string, uid: number, corporationId: bigint) {
  return {
    id,
    name,
    userId: uid,
    ownerHash: `hash-${id.toString()}`,
    authzLevel: 'member',
    status: 'active',
    corporationId,
    allianceId: null,
  } as const;
}

async function cleanup() {
  await db.delete(apMap).where(sql`name IN (${ABC_MAP}, ${CHAIN_MAP}, ${NONE_MAP})`);
  await db.delete(apCharacter).where(inArray(apCharacter.id, [OWNER_ID, STRANGER_ID]));
  if (ownerUserId) {
    await db.delete(apUser).where(eq(apUser.id, ownerUserId));
    ownerUserId = 0;
  }
  if (strangerUserId) {
    await db.delete(apUser).where(eq(apUser.id, strangerUserId));
    strangerUserId = 0;
  }
  await db.delete(universeSystem).where(inArray(universeSystem.id, ALL_SYSTEMS));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
  abcMapId = 0n;
  chainMapId = 0n;
  noneMapId = 0n;
}
