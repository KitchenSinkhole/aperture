import type { ExperimentalLayoutPreset, MapLayoutConfig, PanelId } from '@/types';
import {
  EXPERIMENTAL_DEFAULT_MAP_LAYOUT,
  LAYOUT_CONFIG_VERSION,
  PANELS,
  removePanelFromLayout,
} from '@/lib/map/layout/panels';

function keepForPreset(preset: ExperimentalLayoutPreset): Set<PanelId> {
  const canvas = 'canvas' as PanelId;
  if (preset === 'scanning') {
    return new Set([canvas, 'signatures', 'inspector', 'intel']);
  }
  if (preset === 'combat') {
    return new Set([canvas, 'pilots', 'kills']);
  }
  return new Set([canvas, 'route', 'currentRoute']);
}

function applyPanelVisibility(config: MapLayoutConfig, keep: Set<PanelId>): MapLayoutConfig {
  let next = { ...config };
  const hidden: PanelId[] = [];
  for (const p of PANELS) {
    if (keep.has(p.id)) continue;
    next = removePanelFromLayout(next, p.id);
    hidden.push(p.id);
  }
  return { ...next, hidden };
}

function setHeights(config: MapLayoutConfig, sizes: Partial<Record<PanelId, number>>): MapLayoutConfig {
  const layouts = { ...config.layouts };
  for (const bp of ['lg', 'md', 'sm'] as const) {
    const items = layouts[bp]?.map((item) => {
      const id = item.i as PanelId;
      const h = sizes[id];
      return h != null ? { ...item, h } : item;
    });
    if (items) layouts[bp] = items;
  }
  return { ...config, layouts };
}

/** Experimental layout presets — geometry, visibility, and `hidden` for one-click focus modes. */
export function experimentalLayoutPreset(preset: ExperimentalLayoutPreset): MapLayoutConfig {
  let base = structuredClone(EXPERIMENTAL_DEFAULT_MAP_LAYOUT);
  base.version = LAYOUT_CONFIG_VERSION;
  base.layoutPreset = preset;

  const keep = keepForPreset(preset);
  base = applyPanelVisibility(base, keep);

  if (preset === 'scanning') {
    base = setHeights(base, { signatures: 14, inspector: 10, canvas: 8 });
  } else if (preset === 'combat') {
    base = setHeights(base, { canvas: 18, pilots: 10 });
  } else if (preset === 'travel') {
    base = setHeights(base, { canvas: 10, route: 10 });
  }

  return base;
}

export function exportLayoutJson(config: MapLayoutConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importLayoutJson(raw: string): MapLayoutConfig {
  const parsed = JSON.parse(raw) as MapLayoutConfig;
  if (!parsed.layouts || !parsed.groups) throw new Error('Invalid layout');
  return parsed;
}