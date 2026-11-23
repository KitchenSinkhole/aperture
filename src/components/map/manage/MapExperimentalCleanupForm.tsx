'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateMapSettingsAction } from '@/app/(app)/actions/map';
import { experimentalSettingLabel } from '@/lib/experimentalSettingLabel';

type ToggleKey = 'experimentalAutoSignatureCleanup' | 'experimentalAutoMapCleanup';

const TOGGLES: { key: ToggleKey; label: string; description: string }[] = [
  {
    key: 'experimentalAutoSignatureCleanup',
    label: 'Automatic signature cleanup',
    description:
      'Periodically deletes signatures matched by the Signatures panel Clean up filters.',
  },
  {
    key: 'experimentalAutoMapCleanup',
    label: 'Automatic map cleanup',
    description: 'Periodically removes connections already marked expired on the chart.',
  },
];

/**
 * Experimental per-map auto-cleanup toggles (ap_ui). Stored in `ap_map.next_bookmarks`.
 */
export function MapExperimentalCleanupForm({
  mapId,
  initialValues,
}: {
  mapId: string;
  initialValues: Record<ToggleKey, boolean>;
}) {
  const [values, setValues] = useState(initialValues);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateMapSettingsAction({ mapId, ...values });
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
        Automatic cleanup runs while someone has this map open. Filter criteria for signatures come
        from your Signatures panel Clean up settings (per device).
      </p>
      {TOGGLES.map((t) => (
        <label key={t.key} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={values[t.key]}
            onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.checked }))}
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{experimentalSettingLabel(t.label)}</span>
            <span className="text-xs text-muted-foreground">{t.description}</span>
          </span>
        </label>
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save />
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}