// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apCharacter, apCharacterPresence, apIntegrationToken, apMap, apMapEvent, apUser } from '@/db/schema';
import { loadIntegrationActivityStats } from '@/lib/integrations/activityStats';
import { hashIntegrationToken, resolveIntegrationToken } from '@/lib/integrations/token';

/**
 * `/api/integrations/activity-stats` reader + token resolution, against real
 * Postgres.
 *
 * Verifies the two deliberate diffs from the UI's `loadActivityStats`: raw
 * (not main-collapsed) per-character rows, and a caller-defined [from, to] +
 * weekly/daily window — plus the tenant boundary (a corp's token can never
 * see another corp's map activity) and the shared `map.%`/`system.moved`
 * exclusions.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test integration-activity-stats
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP_A = 99600001n;
const CORP_B = 99600002n;

const MAIN_ID = 99601001n;
const ALT_ID = 99601002n;
const OUTSIDER_ID = 99601003n;
const QUIET_ID = 99601004n;
const PRESENCE_ONLY_ID = 99601005n;

const characterIds = [MAIN_ID, ALT_ID, OUTSIDER_ID];

const CORP_A_MAP = 'Integration Corp A Map';
const CORP_B_MAP = 'Integration Corp B Map';

// A Tuesday in ISO week 27, 2026 (Monday = 2026-06-29) and a Monday the
// following week — matches the boundary week used by
// tests/integration/statistics.test.ts.
const TUE_JUN_30 = new Date('2026-06-30T12:00:00Z');
const MON_JUL_06 = new Date('2026-07-06T12:00:00Z');

let userId = 0;
let outsiderUserId = 0;
let corpAMapId = 0n;
let corpBMapId = 0n;

/** N rollup rows of one kind on a map by a character at a given time. */
function events(mapId: bigint, characterId: bigint, kind: string, count: number, when: Date) {
  return Array.from({ length: count }, () => ({
    mapId,
    characterId,
    kind,
    occurredAt: when,
    payload: null,
  }));
}

describe.skipIf(!run)('Integrations — activity stats (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    const [ou] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    outsiderUserId = ou!.id;

    await db.insert(apCharacter).values([
      mkChar(MAIN_ID, 'Main Pilot', userId, CORP_A),
      mkChar(ALT_ID, 'Alt Pilot', userId, CORP_A),
      mkChar(OUTSIDER_ID, 'Outsider', outsiderUserId, CORP_B),
      mkChar(PRESENCE_ONLY_ID, 'Presence Only', userId, CORP_A),
    ]);
    // Main is the account's main; the integration reader must NOT roll the
    // alt's activity up to it (unlike the UI reader).
    await db.update(apUser).set({ mainCharacterId: MAIN_ID }).where(eq(apUser.id, userId));

    const inserted = await db
      .insert(apMap)
      .values([
        { name: CORP_A_MAP, scope: 'all', type: 'corp', ownerCorporationId: CORP_A },
        { name: CORP_B_MAP, scope: 'all', type: 'corp', ownerCorporationId: CORP_B },
      ])
      .returning({ id: apMap.id, name: apMap.name });
    corpAMapId = inserted.find((m) => m.name === CORP_A_MAP)!.id;
    corpBMapId = inserted.find((m) => m.name === CORP_B_MAP)!.id;

    await db.insert(apMapEvent).values([
      // Corp A map, Jun 30 (week of Jun 29).
      ...events(corpAMapId, MAIN_ID, 'system.added', 2, TUE_JUN_30),
      ...events(corpAMapId, MAIN_ID, 'connection.create', 1, TUE_JUN_30),
      ...events(corpAMapId, MAIN_ID, 'map.create', 1, TUE_JUN_30), // excluded (map.*)
      // The alt's own activity — must surface as its own row, not merged into main.
      ...events(corpAMapId, ALT_ID, 'signature.create', 3, TUE_JUN_30),
      // A substantive system.updated counts; a drag-only position move does not.
      {
        mapId: corpAMapId,
        characterId: MAIN_ID,
        kind: 'system.updated',
        occurredAt: TUE_JUN_30,
        payload: { kind: 'system.updated', id: '1', status: 'hostile' },
      },
      {
        mapId: corpAMapId,
        characterId: MAIN_ID,
        kind: 'system.updated',
        occurredAt: TUE_JUN_30,
        payload: { kind: 'system.updated', id: '1', positionX: 10, positionY: 20 },
      },
      // Corp A map, Jul 6 (next ISO week) — a second weekly bucket.
      ...events(corpAMapId, MAIN_ID, 'system.added', 5, MON_JUL_06),
      // Corp B map — CORP_A's token must never see this, even though OUTSIDER
      // is one of the requested characterIds.
      ...events(corpBMapId, OUTSIDER_ID, 'system.added', 7, TUE_JUN_30),
    ]);

    // Presence-only day, after the last activity day (Jul 6) — no edits at
    // all, so the pre-presence reader would have dropped this bucket, and it
    // pushes the corp's coverage window out past the rollup days.
    await db.insert(apCharacterPresence).values({
      characterId: PRESENCE_ONLY_ID,
      corporationId: CORP_A,
      startedAt: new Date('2026-07-20T10:00:00Z'),
      endedAt: new Date('2026-07-20T11:30:00Z'),
    });

    await db.execute(sql`REFRESH MATERIALIZED VIEW "ap_activity_rollup"`);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('returns raw per-character activity, not collapsed to the account main', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds,
      granularity: 'weekly',
    });
    const main = stats.characters.find((c) => c.characterId === Number(MAIN_ID));
    const alt = stats.characters.find((c) => c.characterId === Number(ALT_ID));
    expect(main).toBeDefined();
    expect(alt).toBeDefined();

    const mainWeek1 = main!.buckets.find((b) => b.bucketStart === '2026-06-29')!;
    expect(mainWeek1.system.create).toBe(2);
    expect(mainWeek1.system.update).toBe(1); // substantive update only
    expect(mainWeek1.connection.create).toBe(1);
    expect(mainWeek1.signature.create).toBe(0); // the alt's, not main's

    const altWeek1 = alt!.buckets.find((b) => b.bucketStart === '2026-06-29')!;
    expect(altWeek1.signature.create).toBe(3);
    expect(altWeek1.system.create).toBe(0);
  });

  it('scopes strictly to the token corp — outsider activity on another corp never leaks', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds,
      granularity: 'weekly',
    });
    const outsider = stats.characters.find((c) => c.characterId === Number(OUTSIDER_ID));
    expect(outsider).toBeDefined();
    expect(outsider!.buckets).toEqual([]);
  });

  it('buckets weekly by the Monday of the ISO week, across two weeks', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds,
      granularity: 'weekly',
    });
    const main = stats.characters.find((c) => c.characterId === Number(MAIN_ID))!;
    expect(main.buckets.map((b) => b.bucketStart)).toEqual(['2026-06-29', '2026-07-06']);
    expect(main.buckets[1]!.system.create).toBe(5);
  });

  it('buckets daily when granularity=daily', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds,
      granularity: 'daily',
    });
    const main = stats.characters.find((c) => c.characterId === Number(MAIN_ID))!;
    expect(main.buckets.map((b) => b.bucketStart)).toEqual(['2026-06-30', '2026-07-06']);
  });

  it('respects a caller-defined [from, to] window', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds,
      from: '2026-07-01',
      to: '2026-07-31',
      granularity: 'weekly',
    });
    const main = stats.characters.find((c) => c.characterId === Number(MAIN_ID))!;
    // The Jun 30 week is excluded by `from`; only the Jul 6 bucket remains.
    expect(main.buckets.map((b) => b.bucketStart)).toEqual(['2026-07-06']);
  });

  it('returns every requested character in request order, quiet ones with empty buckets', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds: [QUIET_ID, MAIN_ID],
      granularity: 'weekly',
    });
    expect(stats.characters.map((c) => c.characterId)).toEqual([Number(QUIET_ID), Number(MAIN_ID)]);
    expect(stats.characters[0]!.buckets).toEqual([]);
  });

  it('reports coverage as the min/max of rollup days and presence days within the corp scope', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds,
      granularity: 'weekly',
    });
    // Latest widens past the last rollup day (Jul 6) to the presence-only day
    // (Jul 20), even though `characterIds` here doesn't include PRESENCE_ONLY_ID —
    // coverage is corp-scoped, not character-scoped.
    expect(stats.coverage).toEqual({ earliest: '2026-06-30', latest: '2026-07-20' });
  });

  it('a character with presence but zero edits produces a bucket with zeroed counters and non-zero online.seconds', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: CORP_A,
      characterIds: [PRESENCE_ONLY_ID],
      granularity: 'daily',
    });
    const char = stats.characters.find((c) => c.characterId === Number(PRESENCE_ONLY_ID));
    expect(char).toBeDefined();
    expect(char!.buckets).toHaveLength(1);
    const bucket = char!.buckets[0]!;
    expect(bucket.bucketStart).toBe('2026-07-20');
    expect(bucket.system).toEqual({ create: 0, update: 0, delete: 0 });
    expect(bucket.connection).toEqual({ create: 0, update: 0, delete: 0 });
    expect(bucket.signature).toEqual({ create: 0, update: 0, delete: 0 });
    expect(bucket.online.seconds).toBe(90 * 60);
    expect(bucket.online.sessions).toBe(1);
    expect(bucket.online.lastSeenAt).toBe('2026-07-20T11:30:00.000Z');
  });

  it('returns empty buckets and null coverage for a corp with no corp-type maps', async () => {
    const stats = await loadIntegrationActivityStats({
      corporationId: 99_609_999n,
      characterIds,
      granularity: 'weekly',
    });
    expect(stats.coverage).toEqual({ earliest: null, latest: null });
    expect(stats.characters.every((c) => c.buckets.length === 0)).toBe(true);
  });

  describe('resolveIntegrationToken', () => {
    const RAW_TOKEN = 'integration-test-raw-token';
    const REVOKED_RAW_TOKEN = 'integration-test-revoked-token';

    beforeAll(async () => {
      await db.insert(apIntegrationToken).values([
        {
          tokenHash: hashIntegrationToken(RAW_TOKEN),
          corporationId: CORP_A,
          label: 'test-consumer',
        },
        {
          tokenHash: hashIntegrationToken(REVOKED_RAW_TOKEN),
          corporationId: CORP_A,
          label: 'test-consumer-revoked',
          revokedAt: new Date(),
        },
      ]);
    });

    it('resolves a live token to its corporation', async () => {
      const req = new Request('https://example.test/', {
        headers: { authorization: `Bearer ${RAW_TOKEN}` },
      });
      const resolved = await resolveIntegrationToken(req);
      expect(resolved).toEqual({ corporationId: CORP_A, label: 'test-consumer', allowedScopes: null });
    });

    it('rejects a revoked token', async () => {
      const req = new Request('https://example.test/', {
        headers: { authorization: `Bearer ${REVOKED_RAW_TOKEN}` },
      });
      expect(await resolveIntegrationToken(req)).toBeNull();
    });

    it('rejects an unknown token', async () => {
      const req = new Request('https://example.test/', {
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(await resolveIntegrationToken(req)).toBeNull();
    });
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
  await db.delete(apIntegrationToken).where(eq(apIntegrationToken.corporationId, CORP_A));
  await db.delete(apMap).where(sql`name IN (${CORP_A_MAP}, ${CORP_B_MAP})`);
  await db.delete(apCharacter).where(inArray(apCharacter.id, [...characterIds, PRESENCE_ONLY_ID]));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  if (outsiderUserId) {
    await db.delete(apUser).where(eq(apUser.id, outsiderUserId));
    outsiderUserId = 0;
  }
  corpAMapId = 0n;
  corpBMapId = 0n;
}
