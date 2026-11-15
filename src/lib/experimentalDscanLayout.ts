import type { MapLayoutConfig } from '@/types';

export type ExperimentalDscanPanelSettings = {
  /** map system id → last attached paste text */
  attachedBySystemId: Record<string, string>;
};

const EMPTY: ExperimentalDscanPanelSettings = { attachedBySystemId: {} };

export function parseExperimentalDscanPanelSettings(
  layout: MapLayoutConfig,
): ExperimentalDscanPanelSettings {
  const raw = layout.panelSettings?.dscan;
  if (!raw || typeof raw !== 'object') return EMPTY;
  const attached = (raw as { attachedBySystemId?: unknown }).attachedBySystemId;
  if (!attached || typeof attached !== 'object') return EMPTY;
  const attachedBySystemId: Record<string, string> = {};
  for (const [k, v] of Object.entries(attached)) {
    if (typeof v === 'string') attachedBySystemId[k] = v;
  }
  return { attachedBySystemId };
}

export function mergeDscanAttach(
  layout: MapLayoutConfig,
  mapSystemId: string,
  text: string,
): MapLayoutConfig {
  const prev = parseExperimentalDscanPanelSettings(layout);
  return {
    ...layout,
    panelSettings: {
      ...layout.panelSettings,
      dscan: {
        ...prev,
        attachedBySystemId: { ...prev.attachedBySystemId, [mapSystemId]: text },
      },
    },
  };
}