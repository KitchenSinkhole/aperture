'use client';

import { useRef, useSyncExternalStore } from 'react';
import { Volume2, VolumeOff, VolumeX } from 'lucide-react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Button } from '@/components/ui/button';
import { getSoundEngine } from '@/lib/sounds/engine';

/**
 * Map-toolbar speaker: says whether cues can play right now and offers a
 * one-click device mute. Mounted only when the account's master switch is on
 * (`MapCanvas`), so an account with sounds off has no toolbar control at all.
 */

type SoundButtonState = 'locked' | 'muted' | 'live';

const LABELS: Record<SoundButtonState, string> = {
  locked: 'Click to enable sounds',
  muted: 'Sounds muted on this device, click to unmute',
  live: 'Sounds on, click to mute on this device',
};

export function SoundToolbarButton() {
  const engine = getSoundEngine();
  const status = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getServerSnapshot,
  );

  const state: SoundButtonState = !status.unlocked ? 'locked' : status.muted ? 'muted' : 'live';
  const label = LABELS[state];

  // The engine also unlocks from its own document gesture listener, which runs
  // on the pointerdown of this very press and can flip the rendered state to
  // live before the click dispatches. The decision is therefore latched from
  // the state the gesture began in: while audio is locked the click only buys
  // permission, and muting would hide the one state the indicator exists for.
  const gestureState = useRef<SoundButtonState | null>(null);
  const onGestureStart = () => {
    gestureState.current = state;
  };

  const onClick = () => {
    const decidedIn = gestureState.current ?? state;
    gestureState.current = null;
    if (decidedIn === 'locked') engine.unlock();
    else engine.toggleMute();
  };

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onPointerDown={onGestureStart}
            onKeyDown={onGestureStart}
            onClick={onClick}
          >
            {state === 'locked' ? (
              <VolumeOff className="size-3.5 text-amber-500" />
            ) : state === 'muted' ? (
              <VolumeX className="text-muted-foreground size-3.5" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
          </Button>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="bottom" align="center">
          <Tooltip.Popup className="bg-popover text-popover-foreground z-50 max-w-[18rem] rounded-md border px-2 py-1 text-xs shadow-md">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
