// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apMap,
  apMapSystem,
  universeConstellation,
  universeKillmail,
  universeRegion,
  universeSystem,
} from '@/db/schema';
import { killmailSchema } from '@/lib/esi/decoders';
import { __resetZkbFeedState, pollOnce } from '@/lib/integrations/zkbFeed';
import { loadUserApiProjection } from '@/lib/userApi/projection';
import { r2z2Kill } from '../fixtures/zkbR2z2';

/**
 * The zKillboard live feed's killmail persistence against real Postgres: an
 * on-map kill in the R2Z2 shape lands in `universe_killmail` as a body
 * `killmailSchema` parses, with the generated `solar_system_id` and zKB's
 * `total_value`, and reaches the user API's `kills` projection; a kill in a
 * system on no active map, and one whose body fails the schema, are not
 * persisted. The feed's HTTP is stubbed; the index and the writes are real.
 *
 * Ids use a 9735xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test zkb-feed-persist
 */
const run = process.env.RUN_DB_TESTS === '1';

const REGION = 97350001;
const CONSTELLATION = 97350001;
const SYS_ON_MAP = 97350001;
const SYS_OFF_MAP = 97350002;
const systemIds = [SYS_ON_MAP, SYS_OFF_MAP];

const KILL_ON_MAP = 97350001;
const KILL_OFF_MAP = 97350002;
const KILL_BAD_BODY = 97350003;
const killIds = [KILL_ON_MAP, KILL_OFF_MAP, KILL_BAD_BODY].map(BigInt);

const MAP_NAME = 'zKB Feed Persist Map';

let mapId = 0n;
const originalFetch = globalThis.fetch;

function feedOf(...entries: unknown[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/sequence.json')) return Response.json({ sequence: 100 });
    const seq = Number(url.match(/\/(\d+)\.json$/)?.[1]);
    const entry = entries[seq - 101];
    return entry === undefined ? new Response('', { status: 404 }) : Response.json(entry);
  }) as typeof fetch;
}

async function cachedRow(id: number) {
  const [row] = await db.select().from(universeKillmail).where(eq(universeKillmail.id, BigInt(id)));
  return row;
}

describe.skipIf(!run)('zKB feed killmail persistence (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();
    await db.insert(universeRegion).values({ id: REGION, name: 'Feed Persist Region' });
    await db
      .insert(universeConstellation)
      .values({ id: CONSTELLATION, regionId: REGION, name: 'Feed Persist Const' });
    await db.insert(universeSystem).values([
      { id: SYS_ON_MAP, constellationId: CONSTELLATION, name: 'ZFP On', security: 'C3' },
      { id: SYS_OFF_MAP, constellationId: CONSTELLATION, name: 'ZFP Off', security: 'C3' },
    ]);
    const [m] = await db
      .insert(apMap)
      .values({ name: MAP_NAME, scope: 'wh', type: 'corp', ownerCorporationId: 97359001n })
      .returning({ id: apMap.id });
    mapId = m!.id;
    await db.insert(apMapSystem).values({ mapId, systemId: SYS_ON_MAP, visible: true, positionX: 0, positionY: 0 });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    __resetZkbFeedState();
    await db.delete(universeKillmail).where(inArray(universeKillmail.id, killIds));
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('persists an on-map R2Z2 kill as a row killmailSchema parses, and projects it', async () => {
    const killmailTime = new Date(Date.now() - 60_000).toISOString();
    globalThis.fetch = feedOf(
      r2z2Kill({ killmailId: KILL_ON_MAP, systemId: SYS_ON_MAP, killmailTime, hash: 'persist-hash', totalValue: 1_234.5 }),
    );
    await pollOnce();
    const result = await pollOnce();
    expect(result).toMatchObject({ processed: 1, notified: 1, persisted: 1 });

    const row = await cachedRow(KILL_ON_MAP);
    expect(row).toMatchObject({ hash: 'persist-hash', solarSystemId: SYS_ON_MAP, totalValue: 1_234.5 });
    expect(row!.killmailTime.toISOString()).toBe(killmailTime);
    expect(killmailSchema.safeParse(row!.body).success).toBe(true);

    const { data } = await loadUserApiProjection(mapId, 'kills', { active: false, cleared: true, userId: 0 });
    expect(data).toContainEqual(
      expect.objectContaining({
        killmailId: String(KILL_ON_MAP),
        systemId: SYS_ON_MAP,
        attackerCount: 2,
        totalValue: 1_234.5,
      }),
    );
  });

  it('does not persist a kill in a system on no active map', async () => {
    globalThis.fetch = feedOf(r2z2Kill({ killmailId: KILL_OFF_MAP, systemId: SYS_OFF_MAP }));
    await pollOnce();
    const result = await pollOnce();
    expect(result).toMatchObject({ processed: 1, notified: 0, persisted: 0 });
    expect(await cachedRow(KILL_OFF_MAP)).toBeUndefined();
  });

  it('skips a body that fails killmailSchema and still flashes it', async () => {
    const entry = r2z2Kill({ killmailId: KILL_BAD_BODY, systemId: SYS_ON_MAP });
    const esi: Partial<typeof entry.esi> = { ...entry.esi };
    delete esi.victim;
    globalThis.fetch = feedOf({ ...entry, esi });
    await pollOnce();
    const result = await pollOnce();
    expect(result).toMatchObject({ processed: 1, notified: 1, persisted: 0 });
    expect(await cachedRow(KILL_BAD_BODY)).toBeUndefined();
  });
});

async function cleanup() {
  await db.delete(universeKillmail).where(inArray(universeKillmail.id, killIds));
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db.delete(universeSystem).where(inArray(universeSystem.id, systemIds));
  await db.delete(universeConstellation).where(eq(universeConstellation.id, CONSTELLATION));
  await db.delete(universeRegion).where(eq(universeRegion.id, REGION));
}
