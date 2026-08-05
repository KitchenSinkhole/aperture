'use client';

import { setupRunSdeIngest } from '@/app/(setup)/actions';
import { SetupCard } from './SetupCard';

export function RunSdeIngestCard() {
  return (
    <SetupCard
      title="Re-ingest the current SDE build"
      description="Enqueues the sde-ingest graphile-worker task. Re-runs the whole pipeline against the build this database already holds (the pinned bootstrap build if it holds none): re-binds the vendored CSVs and re-syncs universe_* rows. Use it after hand-editing a CSV or recovering from a partial write. To move onto a newer build, use Refresh to latest instead. Long-running; watch ap_job_run for progress."
      buttonLabel="Re-ingest current build"
      pendingLabel="Enqueuing…"
      action={setupRunSdeIngest}
      renderResult={(d) => `Enqueued job ${d.jobId || '(id missing)'}.`}
      successMessage="Queued."
    />
  );
}
