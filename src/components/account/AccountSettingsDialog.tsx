'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Star, Trash2, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SignatureIndicatorAccountSettings, SoundEvent, SoundId, SoundPrefs } from '@/types';
import { SOUND_EVENTS } from '@/lib/sounds/prefs';
import { SOUND_EVENT_LABELS } from '@/lib/sounds/catalog';
import { getCustomSoundStore, useCustomSounds } from '@/lib/sounds/customStore';
import { getSoundEngine, useSoundPrefs } from '@/lib/sounds/engine';
import { announceSoundPrefs, subscribeSoundPrefs } from '@/lib/sounds/prefsSync';
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
import { useExperimentalUi } from '@/lib/experimentalUi.client';
import type { ExperimentalUiMode } from '@/lib/experimentalUi';
import {
  DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS,
  EXPERIMENTAL_HOVER_DELAY_MAX_MS,
  EXPERIMENTAL_HOVER_DELAY_MIN_MS,
  clampExperimentalHoverDelayMs,
} from '@/lib/experimentalHoverDelay';
import { useExperimentalHoverDelayContext } from '@/lib/experimentalHoverDelay.client';
import { isExperimentalUiActive } from '@/lib/experimentalUi';
import {
  readExperimentalRallyDesktopNotification,
  readExperimentalRallyToast,
  readExperimentalRouteHazardToast,
  readExperimentalRouteOffRouteToast,
  writeExperimentalRallyDesktopNotification,
  writeExperimentalRallyToast,
  writeExperimentalRouteHazardToast,
  writeExperimentalRouteOffRouteToast,
} from '@/lib/experimentalAlertPrefs';
import { experimentalSettingLabel } from '@/lib/experimentalSettingLabel';
import {
  readExperimentalAutoMassFromLog,
  readExperimentalPointerCursor,
  readKeepMapSelection,
  readPastePreviewOnCtrlV,
  writeExperimentalAutoMassFromLog,
  writeExperimentalPointerCursor,
  writeKeepMapSelection,
  writePastePreviewOnCtrlV,
} from '@/lib/experimentalQolPrefs';

const EXPERIMENTAL_UI_CHOICES: { value: ExperimentalUiMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'aperture', label: 'Aperture (default)' },
  { value: 'slate', label: 'Experimental slate' },
  { value: 'light', label: 'Light' },
  { value: 'classic', label: 'Pathfinder classic' },
];

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
  const [experimentalUi, setExperimentalUi] = useExperimentalUi();
  const { delayMs: hoverDelayMs, setDelayMs: setHoverDelayMs } = useExperimentalHoverDelayContext();
  const [hoverDelayInput, setHoverDelayInput] = useState(String(hoverDelayMs));
  const experimentalOn = isExperimentalUiActive(experimentalUi);
  const [keepSelection, setKeepSelection] = useState(readKeepMapSelection);
  const [pointerCursor, setPointerCursor] = useState(readExperimentalPointerCursor);
  const [pastePreview, setPastePreview] = useState(readPastePreviewOnCtrlV);
  const [rallyToast, setRallyToast] = useState(readExperimentalRallyToast);
  const [rallyDesktop, setRallyDesktop] = useState(readExperimentalRallyDesktopNotification);
  const [routeOffRouteToast, setRouteOffRouteToast] = useState(readExperimentalRouteOffRouteToast);
  const [routeHazardToast, setRouteHazardToast] = useState(readExperimentalRouteHazardToast);
  const [autoMass, setAutoMass] = useState(readExperimentalAutoMassFromLog);
  const [experimentalSettingsQuery, setExperimentalSettingsQuery] = useState('');

  function experimentalSectionVisible(...labels: string[]): boolean {
    if (!experimentalOn) return true;
    const q = experimentalSettingsQuery.trim().toLowerCase();
    if (!q) return true;
    return labels.some((label) => label.toLowerCase().includes(q));
  }

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

  // Sound prefs are edited as one blob and persisted whole on every change. The
  // engine holds the live copy every sound surface reads; only `volume` can run
  // ahead of the server (it commits on release, not on every drag frame), so
  // `committedVolume` is what a rollback restores.
  const engine = getSoundEngine();
  const sounds = useSoundPrefs();
  const committedVolume = useRef(soundPrefs.volume);

  // Adopt the server's copy whenever its content changes (first mount, a save
  // on another device picked up by any refresh). Comparing content, not
  // identity, keeps a re-render with the same saved value from clobbering an
  // optimistic edit that is still in flight.
  const seededPrefs = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify(soundPrefs);
    if (key === seededPrefs.current) return;
    seededPrefs.current = key;
    engine.setPrefs(soundPrefs);
    committedVolume.current = soundPrefs.volume;
  }, [engine, soundPrefs]);

  // A save in another tab on this device reaches this one without a reload.
  useEffect(
    () =>
      subscribeSoundPrefs((next) => {
        engine.setPrefs(next);
        committedVolume.current = next.volume;
      }),
    [engine],
  );

  function commitSounds(next: SoundPrefs) {
    const prev = { ...sounds, volume: committedVolume.current };
    engine.setPrefs(next);
    committedVolume.current = next.volume;
    startTransition(async () => {
      const result = await setSoundPrefsAction(next);
      if (result.ok) {
        announceSoundPrefs(next);
      } else {
        engine.setPrefs(prev);
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

          <fieldset className="mt-2 flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              Experimental UI
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                Device
              </span>
            </legend>
            <p className="text-xs text-muted-foreground">
              Opt-in preview styling on this device. Stored in a cookie; no page reload.
            </p>
            {experimentalOn ? (
              <input
                type="search"
                placeholder="Filter experimental sections…"
                value={experimentalSettingsQuery}
                onChange={(e) => setExperimentalSettingsQuery(e.target.value)}
                className="border-input h-8 w-full max-w-sm rounded-md border px-2 text-sm"
                aria-label="Filter experimental settings"
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {EXPERIMENTAL_UI_CHOICES.map(({ value, label }) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm',
                    experimentalUi === value && 'border-primary bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="experimental-ui"
                    className="size-4 accent-primary"
                    checked={experimentalUi === value}
                    onChange={() => setExperimentalUi(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {experimentalOn && experimentalSectionVisible('hover delay') ? (
              <div className="mt-1 flex flex-col gap-1">
                <label htmlFor="experimental-hover-delay" className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {experimentalSettingLabel('Hover delay (ms)')}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                    Device
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Tooltips and hover cards on the map wait this long before opening. Stored on this device.
                </p>
                <input
                  id="experimental-hover-delay"
                  type="number"
                  min={EXPERIMENTAL_HOVER_DELAY_MIN_MS}
                  max={EXPERIMENTAL_HOVER_DELAY_MAX_MS}
                  step={25}
                  className="border-input bg-background h-9 w-full max-w-[8rem] rounded-md border px-2 text-sm"
                  value={hoverDelayInput}
                  onChange={(e) => setHoverDelayInput(e.target.value)}
                  onBlur={() => {
                    const trimmed = hoverDelayInput.trim();
                    if (trimmed === '') {
                      setHoverDelayInput(String(DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS));
                      setHoverDelayMs(DEFAULT_EXPERIMENTAL_HOVER_DELAY_MS);
                      return;
                    }
                    const parsed = Number(trimmed);
                    if (!Number.isFinite(parsed)) {
                      setHoverDelayInput(String(hoverDelayMs));
                      toast.error('Enter a number of milliseconds.');
                      return;
                    }
                    const next = clampExperimentalHoverDelayMs(parsed);
                    setHoverDelayInput(String(next));
                    setHoverDelayMs(next);
                  }}
                />
              </div>
            ) : null}
            {experimentalOn && experimentalSectionVisible('qol', 'selection', 'pointer', 'paste', 'mass') ? (
              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {experimentalSettingLabel('Quality of life')}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                    Device
                  </span>
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={keepSelection}
                    onChange={(e) => {
                      setKeepSelection(e.target.checked);
                      writeKeepMapSelection(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Keep selection when clicking empty map')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={pointerCursor}
                    onChange={(e) => {
                      setPointerCursor(e.target.checked);
                      writeExperimentalPointerCursor(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Pointer cursor on buttons')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={pastePreview}
                    onChange={(e) => {
                      setPastePreview(e.target.checked);
                      writePastePreviewOnCtrlV(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Preview signature paste on Ctrl+V')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={autoMass}
                    onChange={(e) => {
                      setAutoMass(e.target.checked);
                      writeExperimentalAutoMassFromLog(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Auto-set link mass from jump log')}
                </label>
              </div>
            ) : null}
          </fieldset>

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
                onChange={(e) =>
                  engine.setPrefs({ ...sounds, volume: Number(e.target.value) / 100 })
                }
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
                          if (e.target.checked) engine.preview(eventPrefs.sound);
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
                        engine.preview(sound);
                      }}
                      onPreview={() => engine.preview(eventPrefs.sound)}
                    />
                  </div>
                );
              })}
            </div>

            {experimentalOn &&
            experimentalSectionVisible('rally', 'route', 'toast', 'notification', 'alerts') ? (
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Extra notifications on this device (off by default). Kill alerts use the Kill in
                  system sound row above.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={rallyToast}
                    onChange={(e) => {
                      setRallyToast(e.target.checked);
                      writeExperimentalRallyToast(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Rally toast')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={rallyDesktop}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setRallyDesktop(on);
                      writeExperimentalRallyDesktopNotification(on);
                      if (
                        on &&
                        typeof Notification !== 'undefined' &&
                        Notification.permission === 'default'
                      ) {
                        void Notification.requestPermission();
                      }
                    }}
                  />
                  {experimentalSettingLabel('Rally desktop notification')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={routeOffRouteToast}
                    onChange={(e) => {
                      setRouteOffRouteToast(e.target.checked);
                      writeExperimentalRouteOffRouteToast(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Active route off-route toast')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={routeHazardToast}
                    onChange={(e) => {
                      setRouteHazardToast(e.target.checked);
                      writeExperimentalRouteHazardToast(e.target.checked);
                    }}
                  />
                  {experimentalSettingLabel('Active route link / EOL alert toast')}
                </label>
              </div>
            ) : null}

            <CustomSoundsSection />
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

/**
 * Imported sound files, held per device in IndexedDB rather than on the
 * account. Rendered only inside the open dialog, so the store is read when
 * someone looks at it rather than on every page load.
 */
function CustomSoundsSection() {
  const customSounds = useCustomSounds();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File) {
    setImporting(true);
    const result = await getCustomSoundStore().add(file);
    setImporting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    getSoundEngine().preview(result.sound.id);
  }

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      <div className="flex items-center gap-3 px-1">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm">Your sounds</span>
          <span className="text-xs text-muted-foreground">
            Short audio files kept on this device only, never uploaded.
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={importing}
          onClick={() => fileInputRef.current?.click()}
        >
          Add file
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-label="Add sound file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear the input so re-picking the same file fires again.
          e.target.value = '';
          if (file) void onImportFile(file);
        }}
      />
      {customSounds.map((sound) => (
        <div key={sound.id} className="flex items-center gap-1 px-1 text-sm">
          <span className="flex-1 truncate">{sound.label}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => getSoundEngine().preview(sound.id)}
            aria-label={`Preview ${sound.label}`}
            title="Preview"
          >
            <Volume2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void getCustomSoundStore().remove(sound.id)}
            aria-label={`Remove ${sound.label}`}
            title="Remove"
          >
            <Trash2 />
          </Button>
        </div>
      ))}
    </div>
  );
}
