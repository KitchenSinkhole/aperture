'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import type { SignatureIndicatorAccountSettings, SoundEvent, SoundId, SoundPrefs } from '@/types';
import { SOUND_EVENTS } from '@/lib/sounds/prefs';
import { SOUND_EVENT_LABELS } from '@/lib/sounds/catalog';
import { getSoundEngine } from '@/lib/sounds/engine';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  setConnectionTravelAnimationAction,
  setMainCharacterAction,
  setSignatureIndicatorPrefsAction,
  setSoundPrefsAction,
} from '@/app/(app)/actions/account';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { SoundPicker } from './SoundPicker';

/** Trim a minutes value to a compact hours string for an input ("" when null). */
function minutesToHoursInput(minutes: number | null): string {
  if (minutes == null) return '';
  return String(Number((minutes / 60).toFixed(2)));
}

export type AccountCharacter = {
  id: string;
  name: string;
  status: 'active' | 'kicked' | 'banned';
  authzLevel: 'member' | 'admin';
};

function portraitUrl(characterId: string, size = 64): string {
  return `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;
}

const ROLE_LABEL: Record<AccountCharacter['authzLevel'], string> = {
  member: 'Member',
  admin: 'Admin',
};

export function AccountSettingsDialog({
  open,
  onOpenChange,
  characters,
  mainCharacterId,
  activeCharacter,
  travelAnimation,
  signatureIndicators,
  soundPrefs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characters: AccountCharacter[];
  mainCharacterId: string | null;
  activeCharacter: { id: string; name: string };
  travelAnimation: boolean;
  signatureIndicators: SignatureIndicatorAccountSettings;
  soundPrefs: SoundPrefs;
}) {
  // Optimistic local copy so the "Main" marker moves immediately on success.
  const [mainId, setMainId] = useState(mainCharacterId);
  const [travelOn, setTravelOn] = useState(travelAnimation);
  const [pending, startTransition] = useTransition();

  // Signature-indicator prefs. The threshold is edited in hours; blank ⇒ use the
  // corp default. The override can never exceed the global cap (server-enforced).
  const globalHours = Number((signatureIndicators.globalThresholdMinutes / 60).toFixed(2));
  const [showStale, setShowStale] = useState(signatureIndicators.showStale);
  const [showUnscanned, setShowUnscanned] = useState(signatureIndicators.showUnscanned);
  const [thresholdHours, setThresholdHours] = useState(
    minutesToHoursInput(signatureIndicators.userThresholdMinutes),
  );

  // Persist all three sig-indicator fields at once (the action takes the full
  // set). `next` overrides the current state for whichever field just changed;
  // on failure we roll back to `prev`.
  function commitSigPrefs(next: {
    showStale: boolean;
    showUnscanned: boolean;
    thresholdHours: string;
  }) {
    const prev = { showStale, showUnscanned, thresholdHours };
    setShowStale(next.showStale);
    setShowUnscanned(next.showUnscanned);
    setThresholdHours(next.thresholdHours);

    const trimmed = next.thresholdHours.trim();
    let thresholdMinutes: number | null = null;
    if (trimmed !== '') {
      const hours = Number(trimmed);
      if (!Number.isFinite(hours) || hours <= 0) {
        setThresholdHours(prev.thresholdHours);
        toast.error('Threshold must be a positive number of hours.');
        return;
      }
      thresholdMinutes = Math.min(
        Math.max(1, Math.round(hours * 60)),
        signatureIndicators.globalThresholdMinutes,
      );
      // Reflect any clamp back into the field.
      setThresholdHours(minutesToHoursInput(thresholdMinutes));
    }

    startTransition(async () => {
      const result = await setSignatureIndicatorPrefsAction({
        thresholdMinutes,
        showStale: next.showStale,
        showUnscanned: next.showUnscanned,
      });
      if (!result.ok) {
        setShowStale(prev.showStale);
        setShowUnscanned(prev.showUnscanned);
        setThresholdHours(prev.thresholdHours);
        toast.error(result.error);
      }
    });
  }

  // Sound prefs are edited as one blob and persisted whole on every change.
  // Only `volume` can run ahead of the server (it commits on release, not on
  // every drag frame), so `committedVolume` is what a rollback restores.
  const [sounds, setSounds] = useState<SoundPrefs>(soundPrefs);
  const committedVolume = useRef(soundPrefs.volume);

  // Keep the engine on the on-screen prefs so a preview auditions what the
  // dialog shows rather than what was last saved.
  useEffect(() => {
    getSoundEngine().setPrefs(sounds);
  }, [sounds]);

  function commitSounds(next: SoundPrefs) {
    const prev = { ...sounds, volume: committedVolume.current };
    setSounds(next);
    committedVolume.current = next.volume;
    startTransition(async () => {
      const result = await setSoundPrefsAction(next);
      if (!result.ok) {
        setSounds(prev);
        committedVolume.current = prev.volume;
        toast.error(result.error);
      }
    });
  }

  // The slider drags (and arrows) ahead of the server; every gesture that can
  // end a volume change funnels through here so a keyboard-only adjustment is
  // saved even if the dialog closes without the slider ever blurring.
  function commitVolume() {
    if (sounds.volume !== committedVolume.current) commitSounds(sounds);
  }

  function commitEvent(event: SoundEvent, patch: { enabled?: boolean; sound?: SoundId }) {
    commitSounds({
      ...sounds,
      events: { ...sounds.events, [event]: { ...sounds.events[event], ...patch } },
    });
  }

  function onSetMain(id: string) {
    if (id === mainId) return;
    startTransition(async () => {
      const result = await setMainCharacterAction(id);
      if (result.ok) {
        setMainId(id);
      } else {
        toast.error(result.error);
      }
    });
  }

  function onToggleTravel(next: boolean) {
    setTravelOn(next);
    startTransition(async () => {
      const result = await setConnectionTravelAnimationAction(next);
      if (!result.ok) {
        setTravelOn(!next);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>
            Your main is the identity the map landing, statistics, and activity log attribute to —
            whichever character you sign in with, you act as your main.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <div className="flex flex-col gap-1">
            {characters.map((c) => {
              const isMain = c.id === mainId;
              const selectable = c.status === 'active' && !isMain && !pending;
              return (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
                    isMain && 'bg-muted',
                  )}
                >
                  <Avatar size="sm">
                    <AvatarImage src={portraitUrl(c.id, 32)} alt={c.name} />
                    <AvatarFallback>{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABEL[c.authzLevel]}</span>
                  {c.status !== 'active' ? (
                    <span className="text-xs text-muted-foreground capitalize">{c.status}</span>
                  ) : isMain ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                      <Star className="size-3.5 fill-current" />
                      Main
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!selectable}
                      onClick={() => onSetMain(c.id)}
                    >
                      Set as main
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <label className="mt-2 flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="font-medium text-foreground">Show connection travel animation</span>
              <span className="text-xs text-muted-foreground">
                Subtle directional pulse when a tracked pilot jumps between connected systems.
              </span>
            </div>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={travelOn}
              disabled={pending}
              onChange={(e) => onToggleTravel(e.target.checked)}
              aria-label="Show connection travel animation"
            />
          </label>

          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="text-sm font-medium text-foreground">Signature indicators</span>
            <span className="text-xs text-muted-foreground">
              Small icons off the top-right of a system mark when its signatures are stale (or a
              wormhole has none) and when sigs aren&apos;t fully scanned.
            </span>

            <label className="mt-2 flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-muted">
              <span className="flex-1">Show stale-signature indicator</span>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={showStale}
                disabled={pending}
                onChange={(e) =>
                  commitSigPrefs({ showStale: e.target.checked, showUnscanned, thresholdHours })
                }
                aria-label="Show stale-signature indicator"
              />
            </label>

            <label className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-muted">
              <span className="flex-1">Show unscanned-signature indicator</span>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={showUnscanned}
                disabled={pending}
                onChange={(e) =>
                  commitSigPrefs({ showStale, showUnscanned: e.target.checked, thresholdHours })
                }
                aria-label="Show unscanned-signature indicator"
              />
            </label>

            <div className="flex items-center gap-3 px-1 py-1 text-sm">
              <div className="flex flex-1 flex-col gap-0.5">
                <span>Mark stale after</span>
                <span className="text-xs text-muted-foreground">
                  Blank uses the corp default ({globalHours}h). You can only set a smaller value.
                </span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0.5}
                  max={globalHours}
                  step={0.5}
                  className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-right text-sm disabled:opacity-50"
                  value={thresholdHours}
                  placeholder={String(globalHours)}
                  disabled={pending || !showStale}
                  onChange={(e) => setThresholdHours(e.target.value)}
                  onBlur={() => commitSigPrefs({ showStale, showUnscanned, thresholdHours })}
                  aria-label="Mark stale after (hours)"
                />
                <span className="text-xs text-muted-foreground">h</span>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border p-3">
            <label className="flex items-center gap-3 text-sm">
              <span className="flex-1 font-medium text-foreground">Sounds</span>
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={sounds.enabled}
                disabled={pending}
                onChange={(e) => commitSounds({ ...sounds, enabled: e.target.checked })}
                aria-label="Play sounds"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              Audio cues for things happening off-screen. Preview works even with sounds off.
            </span>

            <div className="mt-2 flex items-center gap-3 px-1 text-sm">
              <span className="w-16 shrink-0">Volume</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                className="h-4 flex-1 accent-primary disabled:opacity-50"
                value={Math.round(sounds.volume * 100)}
                disabled={pending || !sounds.enabled}
                onChange={(e) => setSounds({ ...sounds, volume: Number(e.target.value) / 100 })}
                onPointerUp={commitVolume}
                onKeyUp={commitVolume}
                onBlur={commitVolume}
                aria-label="Sound volume"
              />
              <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
                {Math.round(sounds.volume * 100)}%
              </span>
            </div>

            <div className="mt-1 flex flex-col gap-1">
              {SOUND_EVENTS.map((event) => {
                const { label, description } = SOUND_EVENT_LABELS[event];
                const eventPrefs = sounds.events[event];
                return (
                  <div key={event} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm">
                    <label className="flex flex-1 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={eventPrefs.enabled}
                        disabled={pending || !sounds.enabled}
                        onChange={(e) => {
                          commitEvent(event, { enabled: e.target.checked });
                          if (e.target.checked) getSoundEngine().preview(eventPrefs.sound);
                        }}
                        aria-label={label}
                      />
                      <span className="flex flex-col gap-0.5">
                        <span>{label}</span>
                        <span className="text-xs text-muted-foreground">{description}</span>
                      </span>
                    </label>
                    <SoundPicker
                      event={event}
                      value={eventPrefs.sound}
                      ariaLabel={`${label} sound`}
                      disabled={pending}
                      onValueChange={(sound) => {
                        commitEvent(event, { sound });
                        getSoundEngine().preview(sound);
                      }}
                      onPreview={() => getSoundEngine().preview(eventPrefs.sound)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">Delete account</span>
              <span className="text-xs text-muted-foreground">
                Permanently removes your account and every character on it. This cannot be undone.
              </span>
            </div>
            <DeleteAccountDialog confirmName={activeCharacter.name} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
