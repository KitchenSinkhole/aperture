import { runCsvIngest } from '@/lib/sde/ingest';
import { SDE_QUEUE } from '../queues';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * graphile-worker wrapper around `runCsvIngest` (the vendored-CSV ingest from
 * `src/lib/sde/ingest.ts` / `pnpm sde:csv`). Enqueued on-demand by the setup
 * wizard so an operator can refresh the wormhole CSV data without re-running
 * the full SDE ingest or shelling into the container. No cron — CSV refreshes
 * are deliberate, not periodic.
 *
 * Requires `universe_system` / `universe_type` to be populated already (the
 * CSV ingest resolves system/type ids against them); run the SDE ingest first
 * on a fresh database.
 */

const NAME = 'csv-ingest';

async function ingest() {
  return await runCsvIngest();
}

export const csvIngest: JobModule = {
  name: NAME,
  queue: SDE_QUEUE,
  run: withInstrumentation(NAME, ingest),
};
