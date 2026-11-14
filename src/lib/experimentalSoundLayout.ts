import type { MapLayoutConfig } from '@/types';
import type { SoundEvent } from '@/lib/sounds/prefs';

export type SystemSoundMute = {
  all?: boolean;
  events?: Partial<Record<SoundEvent, boolean>>;
};

export type ExperimentalSoundLayoutSettings = {
  byMap?: Record<string, Record<string, SystemSoundMute>>;
  followSelectedPilot?: boolean;
};

export const SOUND_EVENT_MENU_LABELS: Record<SoundEvent, string> = {
  pilotArrived: 'Pilot arrived',
  pilotLeft: 'Pilot left',
  watchedJump: 'Watched jump',
  killInSystem: 'Kill in system',
  rallySet: 'Rally set',
  systemPinged: 'System pinged',
  activeRouteOffRoute: 'Active route off-route',
  activeRouteLinkAlert: 'Active route link alert',
};

export function parseExperimentalSoundLayoutSettings(
  layout: MapLayoutConfig,
): ExperimentalSoundLayoutSettings {
  const raw = layout.panelSettings?.sound;
  if (!raw || typeof raw !== 'object') return {};
  const followSelectedPilot =
    'followSelectedPilot' in raw && raw.followSelectedPilot === true;
  const byMapRaw = 'byMap' in raw ? raw.byMap : undefined;
  if (!byMapRaw || typeof byMapRaw !== 'object') {
    return { followSelectedPilot };
  }
  const byMap: Record<string, Record<string, SystemSoundMute>> = {};
  for (const [mapKey, systemsRaw] of Object.entries(byMapRaw)) {
    if (!systemsRaw || typeof systemsRaw !== 'object') continue;
    const systems: Record<string, SystemSoundMute> = {};
    for (const [sysId, muteRaw] of Object.entries(systemsRaw)) {
      if (!muteRaw || typeof muteRaw !== 'object') continue;
      const record = muteRaw as Record<string, unknown>;
      const eventsRaw = record.events;
      const events =
        eventsRaw && typeof eventsRaw === 'object'
          ? (eventsRaw as Partial<Record<SoundEvent, boolean>>)
          : undefined;
      systems[sysId] = {
        all: record.all === true,
        events,
      };
    }
    byMap[mapKey] = systems;
  }
  return { byMap, followSelectedPilot };
}

export function mutedSystemsForMap(
  settings: ExperimentalSoundLayoutSettings,
  mapId: string,
): Record<string, SystemSoundMute> | undefined {
  return settings.byMap?.[mapId];
}

export function isSystemSoundMuted(
  muted: Record<string, SystemSoundMute> | undefined,
  mapSystemId: string,
  event: SoundEvent,
): boolean {
  if (!muted) return false;
  const entry = muted[mapSystemId];
  if (!entry) return false;
  if (entry.all) return true;
  return entry.events?.[event] === true;
}

export function isSystemMutedForDisplay(
  muted: Record<string, SystemSoundMute> | undefined,
  mapSystemId: string,
): boolean {
  if (!muted) return false;
  const entry = muted[mapSystemId];
  if (!entry) return false;
  if (entry.all) return true;
  return entry.events != null && Object.values(entry.events).some(Boolean);
}

export function setSystemMuteAll(
  settings: ExperimentalSoundLayoutSettings,
  mapId: string,
  mapSystemId: string,
  mute: boolean,
): ExperimentalSoundLayoutSettings {
  const byMap = { ...settings.byMap };
  const mapEntry = { ...(byMap[mapId] ?? {}) };
  if (!mute) {
    delete mapEntry[mapSystemId];
  } else {
    mapEntry[mapSystemId] = { all: true };
  }
  if (Object.keys(mapEntry).length === 0) delete byMap[mapId];
  else byMap[mapId] = mapEntry;
  return { ...settings, byMap };
}

export function toggleSystemMuteEvent(
  settings: ExperimentalSoundLayoutSettings,
  mapId: string,
  mapSystemId: string,
  event: SoundEvent,
  muted: boolean,
): ExperimentalSoundLayoutSettings {
  const byMap = { ...settings.byMap };
  const mapEntry = { ...(byMap[mapId] ?? {}) };
  const prev = mapEntry[mapSystemId] ?? {};
  const events = { ...prev.events };
  if (muted) events[event] = true;
  else delete events[event];
  const all = prev.all === true;
  const next: SystemSoundMute = {
    ...(all ? { all: true } : {}),
    ...(Object.keys(events).length > 0 ? { events } : {}),
  };
  if (!next.all && !next.events) delete mapEntry[mapSystemId];
  else mapEntry[mapSystemId] = next;
  if (Object.keys(mapEntry).length === 0) delete byMap[mapId];
  else byMap[mapId] = mapEntry;
  return { ...settings, byMap };
}

export function mergeSoundPanelSettings(
  layout: MapLayoutConfig,
  sound: ExperimentalSoundLayoutSettings,
): MapLayoutConfig {
  return {
    ...layout,
    panelSettings: { ...layout.panelSettings, sound },
  };
}
