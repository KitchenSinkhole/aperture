'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { adminSetOverlayFitOverflow } from '@/app/(admin)/actions/settings';
import type { OverlayFitOverflow } from '@/types';

const OPTIONS: { value: OverlayFitOverflow; label: string; hint: string }[] = [
  {
    value: 'truncate_cascade',
    label: 'Truncate Name first, then Pilot (default)',
    hint: 'Name shrinks to its minimum before Pilot gives up anything, and Type only once both are at the floor.',
  },
  {
    value: 'proportional',
    label: 'Share it across all three columns',
    hint: 'Each column gives up part of the overrun in proportion to its own fitted width.',
  },
  {
    value: 'grow_window',
    label: 'Widen the overlay window',
    hint: 'Every column keeps its fitted width and the floating window grows to match.',
  },
  {
    value: 'eat_pilot',
    label: 'Take it all from Pilot',
    hint: 'Name and Type keep their fitted width.',
  },
  {
    value: 'eat_name',
    label: 'Take it all from Name',
    hint: 'Pilot and Type keep their fitted width.',
  },
  {
    value: 'eat_type',
    label: 'Take it all from Type',
    hint: 'Pilot and Name keep their fitted width.',
  },
];

/**
 * Global-admin editor for the instance-wide overlay fit-columns overflow policy
 * (`/admin/settings`) — what happens when fitting the overlay's pilot columns to
 * their content would need more width than the overlay window has.
 */
export function OverlayFitOverflowForm({ initialPolicy }: { initialPolicy: OverlayFitOverflow }) {
  const [policy, setPolicy] = useState<OverlayFitOverflow>(initialPolicy);
  const [pending, startTransition] = useTransition();

  function onSave() {
    startTransition(async () => {
      const result = await adminSetOverlayFitOverflow({ policy });
      if (result.ok) toast.success('Overflow behaviour saved.');
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="overlay-fit-overflow"
              className="mt-1"
              value={option.value}
              checked={policy === option.value}
              disabled={pending}
              onChange={() => setPolicy(option.value)}
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
