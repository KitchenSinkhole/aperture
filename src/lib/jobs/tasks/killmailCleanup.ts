import { inArray, lt, sql } from 'drizzle-orm';
import { apertureConfig } from '../../../../aperture.config';
import { db } from '@/db/client';
import { universeKillmail } from '@/db/schema';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * Killmail-cleanup cron: delete `universe_killmail` rows whose `killmail_time`
 * is older than `KILLMAIL_CACHE_RETENTION_DAYS`. Killmail relevance decays and
 * zKillboard only surfaces recent kills, so age-by-kill-time is the retention
 * key. Deletes in `JOB_DELETE_BATCH_SIZE` chunks until the backlog is drained,
 * bounding each statement's lock footprint.
 */

const NAME = 'killmail-cleanup';

async function reap(): Promise<{ deleted: number }> {
  const cutoff = sql`now() - make_interval(days => ${apertureConfig.KILLMAIL_CACHE_RETENTION_DAYS})`;

  let deleted = 0;
  for (;;) {
    const batch = await db
      .delete(universeKillmail)
      .where(
        inArray(
          universeKillmail.id,
          db
            .select({ id: universeKillmail.id })
            .from(universeKillmail)
            .where(lt(universeKillmail.killmailTime, cutoff))
            .limit(apertureConfig.JOB_DELETE_BATCH_SIZE),
        ),
      )
      .returning({ id: universeKillmail.id });
    deleted += batch.length;
    if (batch.length < apertureConfig.JOB_DELETE_BATCH_SIZE) break;
  }

  return { deleted };
}

export const killmailCleanup: JobModule = {
  name: NAME,
  cron: apertureConfig.KILLMAIL_CLEANUP_CRON,
  run: withInstrumentation(NAME, reap),
};
