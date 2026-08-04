'use client';

import { setupRunSdeRefresh } from '@/app/(setup)/actions';
import { SetupCard } from './SetupCard';

export function RunSdeRefreshCard() {
  return (
    <SetupCard
      title="Refresh to latest SDE build"
      description="Enqueues the sde-refresh graphile-worker task. Checks CCP's latest manifest and ingests it if it is newer than the build this database holds. No-op when already current."
      buttonLabel="Refresh to latest"
      pendingLabel="Enqueuing…"
      action={setupRunSdeRefresh}
      renderResult={(d) => `Enqueued job ${d.jobId || '(id missing)'}.`}
      successMessage="Queued."
    />
  );
}
