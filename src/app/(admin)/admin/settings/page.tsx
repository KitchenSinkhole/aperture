import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import {
  getGlobalRouteSettingsKeepOpen,
  getGlobalStaleThresholdMinutes,
  getOverlayFitOverflow,
} from '@/lib/session';
import { StaleThresholdForm } from '@/components/admin/StaleThresholdForm';
import { OverlayFitOverflowForm } from '@/components/admin/OverlayFitOverflowForm';
import { RouteSettingsKeepOpenForm } from '@/components/admin/RouteSettingsKeepOpenForm';

/**
 * `/admin/settings` — global-admin-only deployment settings: the instance-wide
 * stale-signature threshold, the system overlay's fit-columns overflow policy,
 * and the route planner's settings-popover dismiss default. The per-corp rights
 * matrix was retired in the Stage-4 teardown (migration 0041).
 */
export default async function AdminSettingsPage() {
  const session = await auth();
  if (!(await isAdmin(session))) redirect('/maps');

  const [staleThresholdMinutes, overlayFitOverflow, routeSettingsKeepOpen] = await Promise.all([
    getGlobalStaleThresholdMinutes(),
    getOverlayFitOverflow(),
    getGlobalRouteSettingsKeepOpen(),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Signature indicators</h2>
        <p className="text-sm text-muted-foreground">
          Default age at which a system&apos;s signatures are flagged as stale on the map. Each
          member can override this to a smaller value in their Account settings.
        </p>
        <StaleThresholdForm initialMinutes={staleThresholdMinutes} />
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">System overlay columns</h2>
        <p className="text-sm text-muted-foreground">
          The overlay&apos;s pilot columns can be dragged to any width, and a button fits them to
          their content. Choose what happens when that fit needs more width than the overlay window
          has.
        </p>
        <OverlayFitOverflowForm initialPolicy={overlayFitOverflow} />
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Routes panel settings</h2>
        <p className="text-sm text-muted-foreground">
          The Routes panel keeps its settings behind a button at the top of the panel. Choose what
          an outside click does to that popover. Each member can override this from the popover
          itself.
        </p>
        <RouteSettingsKeepOpenForm initialKeepOpen={routeSettingsKeepOpen} />
      </section>
    </section>
  );
}
