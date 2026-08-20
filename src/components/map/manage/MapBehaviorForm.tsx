'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateMapSettingsAction } from '@/app/(app)/actions/map';

type ToggleKey = 'deleteExpiredConnections' | 'deleteEolConnections' | 'trackAbyssalJumps';

const TOGGLES: { key: ToggleKey; label: string; description: string }[] = [
  {
    key: 'deleteExpiredConnections',
    label: 'Delete expired connections',
    description: 'Auto-remove connections past their lifetime.',
  },
  {
    key: 'deleteEolConnections',
    label: 'Delete EOL connections',
    description: 'Auto-remove connections once they pass end-of-life.',
  },
  {
    key: 'trackAbyssalJumps',
    label: 'Track abyssal jumps',
    description: 'Record abyssal traversals as connections.',
  },
];

/**
 * Behavior toggles for the in-map Settings → Behavior tab. Persists via
 * `updateMapSettingsAction` (gated by `settings_manage`).
 */
export function MapBehaviorForm({
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
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {TOGGLES.map((t) => (
        <label key={t.key} className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={values[t.key]}
            onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.checked }))}
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{t.label}</span>
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
