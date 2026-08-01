// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apCharacter, apCharacterPresence, apIntegrationToken, apUser } from '@/db/schema';
import { loadPresenceBuckets, loadPresenceSessions } from '@/lib/integrations/presence';
import { hashIntegrationToken } from '@/lib/integrations/token';
import { toISODate } from '@/lib/stats/activityShaping';
import { POST as presenceSessionsRoute } from '@/app/api/integrations/presence-sessions/route';

/**
 * `/api/integrations/presence-sessions` reader + endpoint (`presence.ts`),
 * against real Postgres.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test integration-presence
 */
const run = process.env.RUN_DB_TESTS === '1';

const CORP_A = 99610001n;
const CORP_B = 99610002n;

const CHAR_A = 99611001n;
const OUTSIDER_ID = 99611002n;
const QUIET_ID = 99611003n;
const LIVE_ID = 99611004n;
const WINDOW_ID = 99611005n;

const characterIds = [CHAR_A, OUTSIDER_ID];

let userId = 0;
let outsiderUserId = 0;

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

describe.skipIf(!run)('Integrations — presence (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    await cleanup();

    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    const [ou] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    outsiderUserId = ou!.id;

    await db.insert(apCharacter).values([
      mkChar(CHAR_A, 'Presence Pilot', userId, CORP_A),
      mkChar(OUTSIDER_ID, 'Presence Outsider', outsiderUserId, CORP_B),
      mkChar(QUIET_ID, 'Presence Quiet', userId, CORP_A),
      mkChar(LIVE_ID, 'Presence Live', userId, CORP_A),
      mkChar(WINDOW_ID, 'Presence Window', userId, CORP_A),
    ]);
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('scopes strictly to the token corp — outsider presence never leaks even when requested', async () => {
    await db.insert(apCharacterPresence).values({
      characterId: OUTSIDER_ID,
      corporationId: CORP_B,
      startedAt: new Date('2026-07-10T10:00:00Z'),
      endedAt: new Date('2026-07-10T11:00:00Z'),
    });

    const result = await loadPresenceSessions({
      corporationId: CORP_A,
      characterIds,
      to: '2026-07-11',
    });
    const outsider = result.characters.find((c) => c.characterId === Number(OUTSIDER_ID));
    expect(outsider).toBeDefined();
    expect(outsider!.sessions).toEqual([]);
  });

  it('returns every requested character in request order, quiet ones with empty sessions', async () => {
    const result = await loadPresenceSessions({
      corporationId: CORP_A,
      characterIds: [QUIET_ID, CHAR_A],
      to: '2026-07-31',
    });
    expect(result.characters.map((c) => c.characterId)).toEqual([Number(QUIET_ID), Number(CHAR_A)]);
    expect(result.characters[0]!.sessions).toEqual([]);
  });

  it('a session spanning UTC midnight contributes to both days, summing to its true duration', async () => {
    await db.insert(apCharacterPresence).values({
      characterId: CHAR_A,
      corporationId: CORP_A,
      startedAt: new Date('2026-07-15T22:00:00Z'),
      endedAt: new Date('2026-07-16T02:00:00Z'),
    });

    const buckets = await loadPresenceBuckets({
      corporationId: CORP_A,
      characterIds: [CHAR_A],
      from: '2026-07-15',
      to: '2026-07-16',
      granularity: 'daily',
    });
    const charBuckets = buckets.get(CHAR_A.toString())!;
    const day1 = charBuckets.get('2026-07-15')!;
    const day2 = charBuckets.get('2026-07-16')!;
    expect(day1.seconds).toBe(2 * 3600);
    expect(day2.seconds).toBe(2 * 3600);
    expect(day1.seconds + day2.seconds).toBe(4 * 3600);
  });

  it('clips a session that starts before `from` to the requested window, not just to bucket boundaries', async () => {
    await db.insert(apCharacterPresence).values({
      characterId: CHAR_A,
      corporationId: CORP_A,
      startedAt: new Date('2026-07-01T10:00:00Z'),
      endedAt: new Date('2026-07-05T02:00:00Z'),
    });

    const buckets = await loadPresenceBuckets({
      corporationId: CORP_A,
      characterIds: [CHAR_A],
      from: '2026-07-04',
      to: '2026-07-05',
      granularity: 'daily',
    });
    const charBuckets = buckets.get(CHAR_A.toString())!;
    // Days before `from` (Jul 1-3) must not appear even though the session
    // started on Jul 1 — only the requested window is bucketed.
    expect([...charBuckets.keys()].sort()).toEqual(['2026-07-04', '2026-07-05']);
    expect(charBuckets.get('2026-07-04')!.seconds).toBe(24 * 3600);
    expect(charBuckets.get('2026-07-05')!.seconds).toBe(2 * 3600);
  });

  it('the `live` flag reflects whether `ended_at` is within the live grace window', async () => {
    const now = new Date();
    const staleStarted = new Date(now.getTime() - 2 * 24 * 3600_000);
    const staleEnded = new Date(staleStarted.getTime() + 5 * 60_000);
    const freshStarted = new Date(now.getTime() - 5_000);

    await db.insert(apCharacterPresence).values([
      { characterId: LIVE_ID, corporationId: CORP_A, startedAt: staleStarted, endedAt: staleEnded },
      { characterId: LIVE_ID, corporationId: CORP_A, startedAt: freshStarted, endedAt: now },
    ]);

    const result = await loadPresenceSessions({
      corporationId: CORP_A,
      characterIds: [LIVE_ID],
      to: toISODate(new Date(now.getTime() + 24 * 3600_000)),
    });
    const sessions = result.characters[0]!.sessions;
    expect(sessions).toHaveLength(2);
    // fetchPresenceRows orders by started_at ascending: stale first, fresh last.
    expect(sessions[0]!.live).toBe(false);
    expect(sessions[1]!.live).toBe(true);
  });

  describe('POST /api/integrations/presence-sessions — window bounds', () => {
    const RAW_TOKEN = 'integration-presence-window-test-token';

    beforeAll(async () => {
      await db.insert(apIntegrationToken).values({
        tokenHash: hashIntegrationToken(RAW_TOKEN),
        corporationId: CORP_A,
        label: 'presence-window-test',
      });
      await db.insert(apCharacterPresence).values([
        // 30 days before the `to` anchor — inside the 90-day default window.
        {
          characterId: WINDOW_ID,
          corporationId: CORP_A,
          startedAt: new Date('2026-07-01T00:00:00Z'),
          endedAt: new Date('2026-07-01T01:00:00Z'),
        },
        // ~152 days before the anchor — outside the 90-day default window.
        {
          characterId: WINDOW_ID,
          corporationId: CORP_A,
          startedAt: new Date('2026-03-01T00:00:00Z'),
          endedAt: new Date('2026-03-01T01:00:00Z'),
        },
      ]);
    });

    function request(body: unknown): NextRequest {
      return new NextRequest('https://example.test/api/integrations/presence-sessions', {
        method: 'POST',
        headers: { authorization: `Bearer ${RAW_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('an omitted `from` defaults to a 90-day window ending at `to`', async () => {
      const res = await presenceSessionsRoute(
        request({ characterIds: [Number(WINDOW_ID)], to: '2026-07-31' }),
        undefined,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        characters: { characterId: number; sessions: { startedAt: string }[] }[];
      };
      const sessions = json.characters[0]!.sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.startedAt).toBe('2026-07-01T00:00:00.000Z');
    });

    it('an explicit wide-enough `from` reaches sessions the 90-day default excludes', async () => {
      const res = await presenceSessionsRoute(
        request({ characterIds: [Number(WINDOW_ID)], from: '2026-03-01', to: '2026-07-31' }),
        undefined,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as { characters: { sessions: unknown[] }[] };
      expect(json.characters[0]!.sessions).toHaveLength(2);
    });

    it('a window wider than the max is a 400', async () => {
      const res = await presenceSessionsRoute(
        request({ characterIds: [Number(WINDOW_ID)], from: '2025-01-01', to: '2026-07-31' }),
        undefined,
      );
      expect(res.status).toBe(400);
    });
  });
});

async function cleanup() {
  await db.delete(apIntegrationToken).where(eq(apIntegrationToken.corporationId, CORP_A));
  await db
    .delete(apCharacterPresence)
    .where(inArray(apCharacterPresence.characterId, [CHAR_A, OUTSIDER_ID, QUIET_ID, LIVE_ID, WINDOW_ID]));
  await db
    .delete(apCharacter)
    .where(inArray(apCharacter.id, [CHAR_A, OUTSIDER_ID, QUIET_ID, LIVE_ID, WINDOW_ID]));
  if (userId) {
    await db.delete(apUser).where(eq(apUser.id, userId));
    userId = 0;
  }
  if (outsiderUserId) {
    await db.delete(apUser).where(eq(apUser.id, outsiderUserId));
    outsiderUserId = 0;
  }
}
