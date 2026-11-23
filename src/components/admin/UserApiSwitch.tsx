'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { adminSetUserApiEnabled } from '@/app/(admin)/actions/settings';
import { Button } from '@/components/ui/button';

/**
 * Global-admin card on `/admin/settings`: the instance-wide switch for the
 * per-map user API (`/api/v1/*`). Each map's managers still decide whether
 * their own map exposes it.
 */
export function UserApiSwitch({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition();

  function onToggle() {
    const next = !enabled;
    startTransition(async () => {
      const result = await adminSetUserApiEnabled({ enabled: next });
      if (result.ok) toast.success(next ? 'User API turned on.' : 'User API turned off.');
      else toast.error(result.error);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">User API</h2>
        <p className="text-sm text-muted-foreground">
          Lets members create read-only API tokens for maps whose managers have turned the API on.
          Turning it off here disables every token on every map and stops new ones being created.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <p className="text-sm">
          {enabled ? (
            <>
              <strong>On.</strong> Each map&apos;s managers decide whether their map exposes it.
            </>
          ) : (
            <>
              <strong>Off.</strong> Every <code>/api/v1</code> request answers 404.
            </>
          )}
        </p>
        <Button
          type="button"
          variant={enabled ? 'outline' : 'default'}
          disabled={pending}
          onClick={onToggle}
        >
          {enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
    </section>
  );
}
