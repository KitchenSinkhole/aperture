import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import { getGlobalStaleThresholdMinutes } from '@/lib/session';
import { StaleThresholdForm } from '@/components/admin/StaleThresholdForm';

/**
 * `/admin/settings` — global-admin-only deployment settings. Currently the
 * instance-wide stale-signature threshold; the per-corp rights matrix was
 * retired in the Stage-4 teardown (migration 0041).
 */
export default async function AdminSettingsPage() {
  const session = await auth();
  if (!(await isAdmin(session))) redirect('/maps');

  const staleThresholdMinutes = await getGlobalStaleThresholdMinutes();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Signature indicators</h2>
        <p className="text-sm text-muted-foreground">
          Default age at which a system&apos;s signatures are flagged as stale on the map.
          Each member can override this to a smaller value in their Account settings.
        </p>
        <StaleThresholdForm initialMinutes={staleThresholdMinutes} />
      </section>
    </section>
  );
}
