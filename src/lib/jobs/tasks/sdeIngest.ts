import { runSdeIngestChild } from '../sdeIngestChild';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';

/**
 * graphile-worker wrapper around the pinned-build SDE ingest so the setup
 * wizard can trigger an on-demand refresh without shelling into the
 * container. Runs via `runSdeIngestChild` (`../sdeIngestChild.ts`), which
 * isolates the ~100MB YAML parse and bulk upserts in a child process so they
 * don't starve WS heartbeats or contend with the app's `pg.Pool`.
 */

const NAME = 'sde-ingest';

async function ingest() {
  return await runSdeIngestChild();
}

export const sdeIngest: JobModule = {
  name: NAME,
  run: withInstrumentation(NAME, ingest),
};
