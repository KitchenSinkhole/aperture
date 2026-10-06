'use client';

import { Volume2 } from 'lucide-react';
import type { SoundEvent, SoundId } from '@/types';
import { CHIME_SOUNDS, voiceSoundsForEvent } from '@/lib/sounds/catalog';
import { useCustomSounds } from '@/lib/sounds/customStore';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** A sound stored on the account but not available on this device. */
const UNAVAILABLE_LABEL = 'Custom sound';

export function SoundPicker({
  event,
  value,
  onValueChange,
  onPreview,
  disabled = false,
  ariaLabel,
}: {
  event: SoundEvent;
  value: SoundId;
  onValueChange: (id: SoundId) => void;
  onPreview: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const voices = voiceSoundsForEvent(event);
  const customs = useCustomSounds();
  const selected = [...CHIME_SOUNDS, ...voices, ...customs].find((s) => s.id === value);

  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={(v) => onValueChange(v as SoundId)}>
        <SelectTrigger disabled={disabled} aria-label={ariaLabel} className="h-7 w-36">
          <SelectValue>{selected?.label ?? UNAVAILABLE_LABEL}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!selected && (
            <SelectItem value={value}>
              <span className="text-muted-foreground">{UNAVAILABLE_LABEL}</span>
            </SelectItem>
          )}
          <SelectGroup>
            <SelectGroupLabel>Chimes</SelectGroupLabel>
            {CHIME_SOUNDS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectGroupLabel>Voice packs</SelectGroupLabel>
            {voices.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectGroup>
          {customs.length > 0 && (
            <SelectGroup>
              <SelectGroupLabel>Your sounds</SelectGroupLabel>
              {customs.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
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
