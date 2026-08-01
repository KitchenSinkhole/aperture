import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { bucketStart, toISODate } from '@/lib/stats/activityShaping';
import { apertureConfig } from '../../../aperture.config';

/**
 * Per-character presence projection over `ap_character_presence`, scoped to
 * one integration token's corporation — backs `POST
 * /api/integrations/presence-sessions` and the `online` block merged into
 * `/api/integrations/activity-stats` (docs/plans/integration-presence.md).
 * "Presence" here means a connected Aperture WebSocket, not EVE-onlineness.
 */

export interface IntegrationPresenceSession {
  startedAt: string;
  endedAt: string;
  live: boolean;
}

export interface IntegrationCharacterPresence {
  characterId: number;
  sessions: IntegrationPresenceSession[];
}

export interface IntegrationPresenceResponse {
  generatedAt: string;
  coverage: { earliest: string | null; latest: string | null };
  characters: IntegrationCharacterPresence[];
}

export interface IntegrationOnlineSummary {
  seconds: number;
  sessions: number;
  lastSeenAt: string | null;
}

type PresenceRow = {
  character_id: string;
  started_at: Date;
  ended_at: Date;
};

type RawPresenceRow = {
  character_id: string;
  started_at_epoch: string;
  ended_at_epoch: string;
};

type CoverageRow = {
  earliest: string | null;
  latest: string | null;
};

// `db.execute`'s raw-sql path returns timestamptz columns as driver-native
// strings, not `Date` (drizzle's node-postgres session installs an identity
// type parser for them) — extract as epoch seconds instead, matching the
// `to_char`-then-parse convention used elsewhere for raw sql (`activity.ts`).
async function fetchPresenceRows(input: {
  corporationId: bigint;
  characterIds: bigint[];
  from?: string;
  to?: string;
}): Promise<PresenceRow[]> {
  const toDate = input.to ?? toISODate(new Date());
  const charIdList = sql.join(
    input.characterIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const result = await db.execute<RawPresenceRow>(sql`
    SELECT
      character_id::text AS character_id,
      extract(epoch from started_at) AS started_at_epoch,
      extract(epoch from ended_at) AS ended_at_epoch
    FROM ap_character_presence
    WHERE corporation_id = ${input.corporationId}
      AND character_id IN (${charIdList})
      AND started_at < (${toDate}::date + interval '1 day')
      ${input.from ? sql`AND ended_at >= ${input.from}::date` : sql``}
    ORDER BY character_id, started_at
  `);
  return result.rows.map((row) => ({
    character_id: row.character_id,
    started_at: new Date(Number(row.started_at_epoch) * 1000),
    ended_at: new Date(Number(row.ended_at_epoch) * 1000),
  }));
}

/**
 * Min/max presence instant across `corporationId`'s data, independent of any
 * requested characters — shared by `loadPresenceSessions` and by
 * `loadIntegrationActivityStats`, which widens its own rollup-day coverage
 * with this.
 */
export async function loadPresenceCoverage(corporationId: bigint): Promise<CoverageRow> {
  return fetchCoverage(corporationId);
}

async function fetchCoverage(corporationId: bigint): Promise<CoverageRow> {
  const result = await db.execute<CoverageRow>(sql`
    SELECT
      to_char(min(started_at), 'YYYY-MM-DD') AS earliest,
      to_char(max(ended_at), 'YYYY-MM-DD') AS latest
    FROM ap_character_presence
    WHERE corporation_id = ${corporationId}
  `);
  return result.rows[0] ?? { earliest: null, latest: null };
}

function isLive(endedAt: Date): boolean {
  return endedAt.getTime() > Date.now() - apertureConfig.PRESENCE_LIVE_GRACE_MS;
}

/**
 * Loads presence sessions for `characterIds`, scoped strictly to
 * `corporationId` — the same tenant boundary as
 * `loadIntegrationActivityStats`. Returns every session **overlapping**
 * `[from, to]`, not merely one starting inside it. `to` defaults to today
 * (UTC); `from` omitted means unbounded. Every id in `characterIds` appears
 * in `characters`, in request order — a quiet character is `sessions: []`.
 * `coverage` is the min/max presence instant across the corp's data
 * (independent of the requested characters), matching the activity-stats
 * reader's convention.
 */
export async function loadPresenceSessions(input: {
  corporationId: bigint;
  characterIds: bigint[];
  from?: string;
  to?: string;
}): Promise<IntegrationPresenceResponse> {
  const generatedAt = new Date().toISOString();
  const [rows, coverage] = await Promise.all([
    fetchPresenceRows(input),
    fetchCoverage(input.corporationId),
  ]);

  const byCharacter = new Map<string, IntegrationPresenceSession[]>();
  for (const row of rows) {
    let sessions = byCharacter.get(row.character_id);
    if (!sessions) {
      sessions = [];
      byCharacter.set(row.character_id, sessions);
    }
    sessions.push({
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at.toISOString(),
      live: isLive(row.ended_at),
    });
  }

  const characters: IntegrationCharacterPresence[] = input.characterIds.map((id) => ({
    characterId: Number(id),
    sessions: byCharacter.get(id.toString()) ?? [],
  }));

  return { generatedAt, coverage, characters };
}

/**
 * Loads presence clipped into `granularity` buckets over `[from, to]`,
 * reusing `bucketStart`/`toISODate` (`src/lib/stats/activityShaping.ts`) so
 * the day/week boundaries can't drift from the activity-stats reader. A
 * session spanning a bucket boundary contributes to every bucket it
 * touches, clipped to that bucket's span. Returned as a
 * `Map<characterId.toString(), Map<bucketStartISO, IntegrationOnlineSummary>>`
 * so callers (e.g. `loadIntegrationActivityStats`) can merge by the same
 * keys they already group activity buckets by. `lastSeenAt` is the max
 * clipped `ended_at` in that bucket — a real instant, not a synthetic
 * UTC-midnight placeholder.
 */
export async function loadPresenceBuckets(input: {
  corporationId: bigint;
  characterIds: bigint[];
  from?: string;
  to?: string;
  granularity: 'weekly' | 'daily';
}): Promise<Map<string, Map<string, IntegrationOnlineSummary>>> {
  const period = input.granularity === 'weekly' ? 'week' : 'day';
  const bucketMs = period === 'week' ? 7 * 86_400_000 : 86_400_000;
  const rows = await fetchPresenceRows(input);

  // A session can run long before/after [from, to] (a stitched session isn't
  // bounded by the caller's window) — clip to the window before bucketing so
  // a query never surfaces a day/week outside what was asked for.
  const windowStart = input.from ? new Date(`${input.from}T00:00:00.000Z`) : null;
  const windowEnd = new Date(`${input.to ?? toISODate(new Date())}T00:00:00.000Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

  type WorkingSummary = { seconds: number; sessions: number; lastSeenAt: Date };
  const byCharacter = new Map<string, Map<string, WorkingSummary>>();

  for (const row of rows) {
    const effectiveStart =
      windowStart && windowStart.getTime() > row.started_at.getTime() ? windowStart : row.started_at;
    const effectiveEnd = row.ended_at.getTime() > windowEnd.getTime() ? windowEnd : row.ended_at;
    if (effectiveEnd.getTime() <= effectiveStart.getTime()) continue;

    let buckets = byCharacter.get(row.character_id);
    if (!buckets) {
      buckets = new Map();
      byCharacter.set(row.character_id, buckets);
    }

    let cursor = bucketStart(effectiveStart, period);
    while (cursor.getTime() < effectiveEnd.getTime()) {
      const bucketEnd = new Date(cursor.getTime() + bucketMs);
      const clipStart = cursor.getTime() > effectiveStart.getTime() ? cursor : effectiveStart;
      const clipEnd = bucketEnd.getTime() < effectiveEnd.getTime() ? bucketEnd : effectiveEnd;
      const seconds = (clipEnd.getTime() - clipStart.getTime()) / 1000;

      const key = toISODate(cursor);
      const summary = buckets.get(key);
      if (!summary) {
        buckets.set(key, { seconds, sessions: 1, lastSeenAt: clipEnd });
      } else {
        summary.seconds += seconds;
        summary.sessions += 1;
        if (clipEnd.getTime() > summary.lastSeenAt.getTime()) {
          summary.lastSeenAt = clipEnd;
        }
      }

      cursor = bucketEnd;
    }
  }

  const result = new Map<string, Map<string, IntegrationOnlineSummary>>();
  for (const [characterId, buckets] of byCharacter) {
    const converted = new Map<string, IntegrationOnlineSummary>();
    for (const [key, summary] of buckets) {
      converted.set(key, { ...summary, lastSeenAt: summary.lastSeenAt.toISOString() });
    }
    result.set(characterId, converted);
  }
  return result;
}
