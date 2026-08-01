import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMap } from '@/db/schema';
import {
  activityKindExclusion,
  bucketStart,
  emptyTriplet,
  KIND_MAP,
  toISODate,
  type ActivityTriplet,
} from '@/lib/stats/activityShaping';
import { loadPresenceBuckets, loadPresenceCoverage, type IntegrationOnlineSummary } from './presence';

/**
 * Per-character activity projection over `ap_activity_rollup`, scoped to one
 * token's corporation, for `POST /api/integrations/activity-stats`
 * (docs/spec/integration-activity-stats.md). Shares `KIND_MAP` and the
 * `map.%`/`system.moved` exclusions with `src/lib/stats/activity.ts` via
 * `activityShaping.ts`, but differs from that reader in two deliberate ways:
 *
 *   - **No main-character attribution** — returns raw acting `character_id`
 *     counts; consumers own their own alt-identity graph.
 *   - **Caller-defined window + granularity** — buckets `[from, to]` by
 *     `weekly` (Monday, UTC) or `daily` period, not 12 fixed trailing buckets.
 *
 * Merges in `ap_character_presence` (`presence.ts`) so a bucket with presence
 * but no edits still surfaces: a bucket is emitted on activity **or**
 * presence, and every emitted bucket carries an `online` summary (zeroed when
 * there was no presence).
 */

const ZERO_ONLINE_SUMMARY: IntegrationOnlineSummary = { seconds: 0, sessions: 0, lastSeenAt: null };

export interface IntegrationActivityBucket {
  bucketStart: string;
  system: ActivityTriplet;
  connection: ActivityTriplet;
  signature: ActivityTriplet;
  online: IntegrationOnlineSummary;
}

export interface IntegrationCharacterActivity {
  characterId: number;
  buckets: IntegrationActivityBucket[];
}

export interface IntegrationActivityStatsResponse {
  generatedAt: string;
  granularity: 'weekly' | 'daily';
  coverage: { earliest: string | null; latest: string | null };
  characters: IntegrationCharacterActivity[];
}

type AggRow = {
  character_id: string;
  day: string;
  kind: string;
  total: number;
};

type CoverageRow = {
  earliest: string | null;
  latest: string | null;
};

/**
 * Loads activity for `characterIds`, scoped strictly to `corporationId`'s
 * `type='corp'` maps — the tenant boundary a token can never see past. Every
 * requested id appears in `characters` (request order); a character with no
 * activity in scope/range gets `buckets: []`, never omitted.
 */
export async function loadIntegrationActivityStats(input: {
  corporationId: bigint;
  characterIds: bigint[];
  from?: string;
  to?: string;
  granularity: 'weekly' | 'daily';
}): Promise<IntegrationActivityStatsResponse> {
  const { corporationId, characterIds, granularity, from, to } = input;
  const generatedAt = new Date().toISOString();
  const toDate = to ?? toISODate(new Date());
  const period = granularity === 'weekly' ? 'week' : 'day';
  const emptyCoverage: CoverageRow = { earliest: null, latest: null };

  const maps = await db
    .select({ id: apMap.id })
    .from(apMap)
    .where(
      and(
        eq(apMap.type, 'corp'),
        eq(apMap.ownerCorporationId, corporationId),
        isNull(apMap.deletedAt),
      ),
    );
  const mapIds = maps.map((m) => m.id);
  const kindExclusion = activityKindExclusion(sql.raw('r.kind'));
  const charIdList = sql.join(
    characterIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const [activityCoverage, aggRows, presenceBuckets, presenceCoverage] = await Promise.all([
    mapIds.length === 0
      ? Promise.resolve(emptyCoverage)
      : db
          .execute<CoverageRow>(sql`
            SELECT
              to_char(min(r.day), 'YYYY-MM-DD') AS earliest,
              to_char(max(r.day), 'YYYY-MM-DD') AS latest
            FROM ap_activity_rollup r
            WHERE r.map_id IN (${sql.join(mapIds.map((id) => sql`${id}`), sql`, `)})
              AND ${kindExclusion}
          `)
          .then((r) => r.rows[0] ?? emptyCoverage),
    mapIds.length === 0
      ? Promise.resolve([] as AggRow[])
      : db
          .execute<AggRow>(sql`
            SELECT
              r.character_id::text         AS character_id,
              to_char(r.day, 'YYYY-MM-DD') AS day,
              r.kind                       AS kind,
              SUM(r.event_count)::int      AS total
            FROM ap_activity_rollup r
            WHERE r.map_id IN (${sql.join(mapIds.map((id) => sql`${id}`), sql`, `)})
              AND r.character_id IN (${charIdList})
              AND ${kindExclusion}
              ${from ? sql`AND r.day >= ${from}::date` : sql``}
              AND r.day <= ${toDate}::date
            GROUP BY 1, 2, 3
          `)
          .then((r) => r.rows),
    loadPresenceBuckets({ corporationId, characterIds, from, to, granularity }),
    loadPresenceCoverage(corporationId),
  ]);

  const coverage = mergeCoverage(activityCoverage, presenceCoverage);

  interface Bucket {
    system: ActivityTriplet;
    connection: ActivityTriplet;
    signature: ActivityTriplet;
  }
  const byCharacter = new Map<string, Map<string, Bucket>>();

  for (const row of aggRows) {
    const mapped = KIND_MAP[row.kind];
    if (!mapped) continue;
    const [group, action] = mapped;
    const key = toISODate(bucketStart(new Date(`${row.day}T00:00:00Z`), period));

    let charBuckets = byCharacter.get(row.character_id);
    if (!charBuckets) {
      charBuckets = new Map();
      byCharacter.set(row.character_id, charBuckets);
    }
    let bucket = charBuckets.get(key);
    if (!bucket) {
      bucket = { system: emptyTriplet(), connection: emptyTriplet(), signature: emptyTriplet() };
      charBuckets.set(key, bucket);
    }
    bucket[group][action] += row.total;
  }

  const characters: IntegrationCharacterActivity[] = characterIds.map((id) => {
    const idKey = id.toString();
    const charBuckets = byCharacter.get(idKey);
    const charPresence = presenceBuckets.get(idKey);
    const keys = new Set<string>([...(charBuckets?.keys() ?? []), ...(charPresence?.keys() ?? [])]);
    const buckets: IntegrationActivityBucket[] = [...keys].sort().map((key) => ({
      bucketStart: key,
      ...(charBuckets?.get(key) ?? {
        system: emptyTriplet(),
        connection: emptyTriplet(),
        signature: emptyTriplet(),
      }),
      online: charPresence?.get(key) ?? ZERO_ONLINE_SUMMARY,
    }));
    return { characterId: Number(id), buckets };
  });

  return { generatedAt, granularity, coverage, characters };
}

function mergeCoverage(a: CoverageRow, b: CoverageRow): CoverageRow {
  const earliestCandidates = [a.earliest, b.earliest].filter((v): v is string => v !== null).sort();
  const latestCandidates = [a.latest, b.latest].filter((v): v is string => v !== null).sort();
  return {
    earliest: earliestCandidates[0] ?? null,
    latest: latestCandidates.at(-1) ?? null,
  };
}
