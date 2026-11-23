import type { MapLayoutConfig } from '@/types';

export type ExperimentalSoundLayoutSettings = {
  followSelectedPilot?: boolean;
};

export function parseExperimentalSoundLayoutSettings(
  layout: MapLayoutConfig,
): ExperimentalSoundLayoutSettings {
  const raw = layout.panelSettings?.sound;
  if (!raw || typeof raw !== 'object') return {};
  const followSelectedPilot =
    'followSelectedPilot' in raw && raw.followSelectedPilot === true;
  return { followSelectedPilot };
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