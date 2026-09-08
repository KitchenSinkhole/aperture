'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { adminSetRouteSettingsKeepOpen } from '@/app/(admin)/actions/settings';

const OPTIONS: { value: boolean; label: string; hint: string }[] = [
  {
    value: false,
    label: 'Close it (default)',
    hint: 'Clicking anywhere outside the settings dismisses them, the way a menu behaves.',
  },
  {
    value: true,
    label: 'Keep it open',
    hint: 'The settings stay up until the button is pressed again, so they can be adjusted while the routes recompute underneath.',
  },
];

/**
 * Global-admin editor for the instance-wide default dismiss behaviour of the
 * route planner's settings popover (`/admin/settings`). Pilots can override the
 * default either way from the popover itself.
 */
export function RouteSettingsKeepOpenForm({ initialKeepOpen }: { initialKeepOpen: boolean }) {
  const [keepOpen, setKeepOpen] = useState(initialKeepOpen);
  const [pending, startTransition] = useTransition();

  function onSave() {
    startTransition(async () => {
      const result = await adminSetRouteSettingsKeepOpen({ keepOpen });
      if (result.ok) toast.success('Routes popover behaviour saved.');
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => (
          <label key={String(option.value)} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="route-settings-keep-open"
              className="mt-1"
              checked={keepOpen === option.value}
              disabled={pending}
              onChange={() => setKeepOpen(option.value)}
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.label}</span>
              <span className="text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <Button type="button" className="self-start" onClick={onSave} disabled={pending}>
        Save
      </Button>
    </div>
  );
}
