import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import { apMapConnection, universeDogmaAttribute } from '@/db/schema';
import { boundWormholeCodeSql } from '@/lib/map/connectionDeathSnapshot';
import { commitMapEvent } from '@/lib/map/mutations/core';
import type { MapEventPatch } from '@/lib/realtime/protocol';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * Auto-EOL cron: on maps that opt in via `ap_map.auto_eol_connections`, mark a
 * never-EOL'd wormhole `('eol', 'auto')` once it is within
 * `WORMHOLE_EOL_NOMINAL_MS` of its type's catalogued lifetime (dogma
 * `wormholeMaxStableTime`, minutes). The mark is an estimate, not a sighting:
 * the row's `eol_source` says so, and `eol_at` is stamped to the mark time so
 * the estimate is on screen for the full `eol` reap clock before `eolExpiry`
 * can take it.
 *
 * The type comes from the bound signatures (`boundWormholeCodeSql`, the death
 * snapshot's rule). An untyped static falls back to the source system's single
 * static leading into the target's class. K162-only, untyped non-static,
 * disagreeing and ambiguous-static holes are never marked.
 *
 * Runs under the bare-tsx worker: nothing reachable from here may import
 * `server-only`, so the attribute lookup and the static join live in this SQL
 * rather than in the `server-only` wormhole catalog readers.
 */

const NAME = 'auto-eol';
const LIFETIME_ATTRIBUTE = 'wormholeMaxStableTime';

type AutoEolNotes = {
  scanned: number;
  marked: number;
  failed: number;
  unresolvedAttribute?: string;
};

async function markAutoEol(): Promise<AutoEolNotes> {
  const [attr] = await db
    .select({ id: universeDogmaAttribute.id })
    .from(universeDogmaAttribute)
    .where(eq(universeDogmaAttribute.name, LIFETIME_ATTRIBUTE))
    .limit(1);
  if (!attr) {
    return { scanned: 0, marked: 0, failed: 0, unresolvedAttribute: LIFETIME_ATTRIBUTE };
  }

  const candidates = await db.execute<{ connection_id: string; map_id: string }>(sql`
    select c.id as connection_id, c.map_id
    from ap_map_connection c
    join ap_map m on m.id = c.map_id
    cross join lateral (
      select ${boundWormholeCodeSql(sql`w.name`)} as code,
             min(e.value) filter (where w.name <> 'K162') as minutes
      from ap_map_signature s
      join universe_wormhole w on w.type_id = s.type_id
      left join universe_type_attribute_effective e
        on e.type_id = w.type_id and e.attr_id = ${attr.id}
      where s.map_connection_id = c.id
    ) bound
    left join lateral (
      select min(e.value) as minutes
      from ap_map_system src
      join universe_system_static st on st.system_id = src.system_id
      join universe_wormhole w on w.type_id = st.type_id
      join ap_map_system tgt on tgt.id = c.target_map_system_id
      join universe_system tsys on tsys.id = tgt.system_id
      left join universe_type_attribute_effective e
        on e.type_id = w.type_id and e.attr_id = ${attr.id}
      where src.id = c.source_map_system_id and w.target_class = tsys.security
      having count(*) = 1
    ) fallback on bound.code is null and c.is_static
    where m.auto_eol_connections
      and m.deleted_at is null
      and c.scope = 'wh'
      and c.eol_stage = 'none'
      and c.eol_source is null
      and c.confirmed_at is not null
      and c.created_at
          + coalesce(case when bound.code <> 'K162' then bound.minutes end, fallback.minutes)
            * interval '1 minute'
          - make_interval(secs => ${apertureConfig.WORMHOLE_EOL_NOMINAL_MS / 1000}::double precision)
        <= now()
    order by c.created_at
    limit ${apertureConfig.JOB_DELETE_BATCH_SIZE}
  `);

  let marked = 0;
  let failed = 0;
  for (const row of candidates.rows) {
    const connectionId = BigInt(row.connection_id);
    const mapId = BigInt(row.map_id);
    const result = await commitMapEvent({
      mapId,
      characterId: null,
      kind: 'connection.update',
      mutate: async (tx) => {
        // Conditional so a scout's write since the candidate select wins.
        // `updated_at` is left alone: it feeds the death snapshot's
        // `lastAliveAt`, and an estimate is not a sighting.
        const [hit] = await tx
          .update(apMapConnection)
          .set({ eolStage: 'eol', eolSource: 'auto', eolAt: sql`now()` })
          .where(
            and(
              eq(apMapConnection.id, connectionId),
              eq(apMapConnection.mapId, mapId),
              eq(apMapConnection.eolStage, 'none'),
              isNull(apMapConnection.eolSource),
              isNotNull(apMapConnection.confirmedAt),
            ),
          )
          .returning({
            id: apMapConnection.id,
            source: apMapConnection.sourceMapSystemId,
            target: apMapConnection.targetMapSystemId,
            eolAt: apMapConnection.eolAt,
          });
        if (!hit) throw new Error('Connection no longer eligible.');
        const patch: MapEventPatch<'connection.update'> = {
          id: hit.id.toString(),
          source: hit.source.toString(),
          target: hit.target.toString(),
          eolStage: 'eol',
          eolAt: hit.eolAt ? hit.eolAt.toISOString() : null,
          eolSource: 'auto',
        };
        return patch;
      },
    });
    if (result.ok) marked += 1;
    else failed += 1;
  }

  return { scanned: candidates.rows.length, marked, failed };
}

export const autoEol: JobModule = {
  name: NAME,
  cron: '*/5 * * * *',
  run: withInstrumentation(NAME, markAutoEol),
};
