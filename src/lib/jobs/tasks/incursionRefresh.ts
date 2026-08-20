import { db } from '@/db/client';
import { universeIncursion } from '@/db/schema';
import { esiCall } from '@/lib/esi/client';
import { incursionsSchema } from '@/lib/esi/decoders';
import { resolveStaleEntityNames } from '@/lib/eve/entityNames';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

const NAME = 'incursion-refresh';

async function refresh(): Promise<{ fetched: number; infestedSystems: number }> {
  const incursions = await esiCall('getIncursions', { schema: incursionsSchema });

  // Active incursions are few and short-lived, so a full replace is simpler and
  // cheaper than diffing — withdrawing incursions just disappear from the payload.
  await db.transaction(async (tx) => {
    await tx.delete(universeIncursion);
    if (incursions.length > 0) {
      await tx.insert(universeIncursion).values(
        incursions.map((i) => ({
          constellationId: i.constellation_id,
          factionId: BigInt(i.faction_id),
          stagingSolarSystemId: i.staging_solar_system_id,
          hasBoss: i.has_boss,
          influence: i.influence,
          state: i.state,
          type: i.type,
          infestedSolarSystems: i.infested_solar_systems,
        })),
      );
    }
  });

  await resolveStaleEntityNames(incursions.map((i) => i.faction_id));

  return {
    fetched: incursions.length,
    infestedSystems: incursions.reduce((n, i) => n + i.infested_solar_systems.length, 0),
  };
}

export const incursionRefresh: JobModule = {
  name: NAME,
  // ESI caches `/incursions/` for ~5 minutes.
  cron: '*/5 * * * *',
  // A full-replace of the current ESI snapshot: the next tick supersedes a
  // failed run entirely, so retrying past it is only ever duplicate work.
  maxAttempts: 1,
  run: withInstrumentation(NAME, refresh),
};
