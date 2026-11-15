'use client';

import { SOUND_EVENTS } from '@/lib/sounds/prefs';
import {
  mutedSystemsForMap,
  setSystemMuteAll,
  SOUND_EVENT_MENU_LABELS,
  toggleSystemMuteEvent,
  type ExperimentalSoundLayoutSettings,
  type SystemSoundMute,
} from '@/lib/experimentalSoundLayout';

type MapSystemRow = { id: string; name: string; alias: string | null };

function systemLabel(s: MapSystemRow): string {
  const alias = s.alias?.trim();
  if (alias) return `${alias} (${s.name})`;
  return s.name;
}

export function ExperimentalMapSoundMutesPanel({
  mapId,
  mapSystems,
  settings,
  onSettingsChange,
}: {
  mapId: string;
  mapSystems: readonly MapSystemRow[];
  settings: ExperimentalSoundLayoutSettings;
  onSettingsChange: (next: ExperimentalSoundLayoutSettings) => void;
}) {
  const muted = mutedSystemsForMap(settings, mapId) ?? {};
  const byId = new Map(mapSystems.map((s) => [s.id, s]));
  const entries = Object.entries(muted).filter(([id]) => byId.has(id));

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No muted systems on this map. Mute from a system&apos;s map context menu.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map(([mapSystemId, mute]) => {
        const row = byId.get(mapSystemId)!;
        return (
          <li key={mapSystemId} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{systemLabel(row)}</span>
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => onSettingsChange(setSystemMuteAll(settings, mapId, mapSystemId, false))}
              >
                Unmute all
              </button>
            </div>
            <MutedEventToggles
              mapId={mapId}
              mapSystemId={mapSystemId}
              mute={mute}
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
          </li>
        );
      })}
    </ul>
  );
}

function MutedEventToggles({
  mapId,
  mapSystemId,
  mute,
  settings,
  onSettingsChange,
}: {
  mapId: string;
  mapSystemId: string;
  mute: SystemSoundMute;
  settings: ExperimentalSoundLayoutSettings;
  onSettingsChange: (next: ExperimentalSoundLayoutSettings) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {mute.all === true ? (
        <p className="text-xs text-muted-foreground">All notification types are muted.</p>
      ) : null}
      {SOUND_EVENTS.map((event) => {
        const isMuted = mute.all === true || mute.events?.[event] === true;
        const label = SOUND_EVENT_MENU_LABELS[event];
        return (
          <label key={event} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={isMuted}
              disabled={mute.all === true}
              onChange={(e) => {
                onSettingsChange(
                  toggleSystemMuteEvent(settings, mapId, mapSystemId, event, e.target.checked),
                );
              }}
            />
            {label}
          </label>
        );
      })}
    </div>
  );
}