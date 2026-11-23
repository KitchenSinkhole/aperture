'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateMapSettingsAction } from '@/app/(app)/actions/map';
import { experimentalSettingLabel } from '@/lib/experimentalSettingLabel';

/**
 * Experimental per-map automatic signature cleanup (ap_ui). Stored on `ap_map`.
 */
export function MapExperimentalCleanupForm({
  mapId,
  initialExperimentalAutoSignatureCleanup,
}: {
  mapId: string;
  initialExperimentalAutoSignatureCleanup: boolean;
}) {
  const [enabled, setEnabled] = useState(initialExperimentalAutoSignatureCleanup);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateMapSettingsAction({
        mapId,
        experimentalAutoSignatureCleanup: enabled,
      });
      if (result.ok) {
        toast.success('Settings saved.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        Runs while someone has this map open. Filter criteria come from your Signatures panel Clean up
        settings (per device).
      </p>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            {experimentalSettingLabel('Automatic signature cleanup')}
          </span>
          <span className="text-xs text-muted-foreground">
            Periodically deletes signatures matched by the Signatures panel Clean up filters.
          </span>
        </span>
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save />
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}