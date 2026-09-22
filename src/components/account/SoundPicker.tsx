'use client';

import { Volume2 } from 'lucide-react';
import type { SoundId } from '@/types';
import { BUILT_IN_SOUNDS } from '@/lib/sounds/catalog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A sound stored on the account but not available on this device. */
const UNAVAILABLE_LABEL = 'Custom sound';

function labelForSound(id: SoundId): string {
  return BUILT_IN_SOUNDS.find((s) => s.id === id)?.label ?? UNAVAILABLE_LABEL;
}

export function SoundPicker({
  value,
  onValueChange,
  onPreview,
  disabled = false,
  ariaLabel,
}: {
  value: SoundId;
  onValueChange: (id: SoundId) => void;
  onPreview: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const known = BUILT_IN_SOUNDS.some((s) => s.id === value);

  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={(v) => onValueChange(v as SoundId)}>
        <SelectTrigger disabled={disabled} aria-label={ariaLabel} className="h-7 w-36">
          <SelectValue>{labelForSound(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!known && (
            <SelectItem value={value}>
              <span className="text-muted-foreground">{UNAVAILABLE_LABEL}</span>
            </SelectItem>
          )}
          {BUILT_IN_SOUNDS.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={onPreview}
        aria-label={`Preview ${ariaLabel}`}
        title="Preview"
      >
        <Volume2 />
      </Button>
    </div>
  );
}
