import type { Breakpoint, MapLayoutConfig, PanelId } from '@/types';

// Single source of truth for the map dashboard's panels and their default
// arrangement. `DEFAULT_MAP_LAYOUT` is the built-in fixed two-column layout:
// a tall canvas top-left with full-width signatures beneath it, and the info
// modules stacked in a right column.

/** Bumped when the stored shape changes incompatibly; gates a reset/migration. */
export const LAYOUT_CONFIG_VERSION = 1;

/** Responsive breakpoint min-widths (px) and column counts, shared by the grid. */
export const PANEL_BREAKPOINTS: Record<Breakpoint, number> = { lg: 1200, md: 768, sm: 0 };
export const PANEL_COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4 };

export interface PanelDef {
  id: PanelId;
  title: string;
  defaultVisible: boolean;
  minW: number;
  minH: number;
}

/** Registry of every panel, in DOM source order (drives single-column stacking). */
export const PANELS: PanelDef[] = [
  { id: 'canvas', title: 'Map', defaultVisible: true, minW: 4, minH: 6 },
  { id: 'signatures', title: 'Signatures', defaultVisible: true, minW: 6, minH: 3 },
  { id: 'sigSearch', title: 'Signature Search', defaultVisible: true, minW: 4, minH: 3 },
  { id: 'inspector', title: 'Inspector', defaultVisible: true, minW: 1, minH: 3 },
  { id: 'route', title: 'Routes', defaultVisible: true, minW: 2, minH: 2 },
  { id: 'intel', title: 'Intel', defaultVisible: true, minW: 1, minH: 2 },
  { id: 'structure', title: 'Structures', defaultVisible: true, minW: 2, minH: 2 },
  { id: 'killStats', title: 'Kill Statistics', defaultVisible: true, minW: 1, minH: 2 },
  { id: 'systemGraph', title: 'System Graph', defaultVisible: true, minW: 1, minH: 3 },
  { id: 'systemKillboard', title: 'System Killboard', defaultVisible: true, minW: 2, minH: 3 },
  { id: 'tags', title: 'Tags', defaultVisible: true, minW: 1, minH: 2 },
  { id: 'thera', title: 'Eve-Scout', defaultVisible: true, minW: 1, minH: 2 },
];

// Right-column modules, in display order (everything except canvas + signatures).
const RIGHT_COLUMN: PanelId[] = [
  'sigSearch',
  'inspector',
  'route',
  'intel',
  'structure',
  'killStats',
  'systemGraph',
  'systemKillboard',
  'tags',
  'thera',
];

/** Per-panel resize floors, keyed by id. Authoritative — re-applied to stored
 * layouts at render time so lowering a panel's `minW`/`minH` takes effect for
 * existing saved layouts without disturbing their persisted positions. */
export const PANEL_MIN: Record<PanelId, { minW: number; minH: number }> = Object.fromEntries(
  PANELS.map((p) => [p.id, { minW: p.minW, minH: p.minH }]),
) as Record<PanelId, { minW: number; minH: number }>;

/** Stack a column of panels at a fixed x/width, returning their layout items. */
function stack(ids: PanelId[], x: number, w: number, startY: number, h: number) {
  return ids.map((id, idx) => ({
    i: id,
    x,
    y: startY + idx * h,
    w,
    h,
    ...PANEL_MIN[id],
  }));
}

// lg/md: canvas (tall) + signatures (below) on the left, modules stacked right.
const wideLayout = (cols: number) => {
  const leftW = cols === 12 ? 8 : 5;
  const rightX = leftW;
  const rightW = cols - leftW;
  return [
    { i: 'canvas' as PanelId, x: 0, y: 0, w: leftW, h: 12, ...PANEL_MIN.canvas },
    { i: 'signatures' as PanelId, x: 0, y: 12, w: leftW, h: 6, ...PANEL_MIN.signatures },
    ...stack(RIGHT_COLUMN, rightX, rightW, 0, 4),
  ];
};

// sm: single-column stack in DOM source order.
const stackedLayout = (() => {
  let y = 0;
  const items = PANELS.map((p) => {
    const h = p.id === 'canvas' ? 10 : p.id === 'signatures' ? 6 : 4;
    const item = { i: p.id, x: 0, y, w: 4, h, minW: p.minW, minH: p.minH };
    y += h;
    return item;
  });
  return items;
})();

export const DEFAULT_MAP_LAYOUT: MapLayoutConfig = {
  version: LAYOUT_CONFIG_VERSION,
  layouts: {
    lg: wideLayout(12),
    md: wideLayout(8),
    sm: stackedLayout,
  },
  hidden: [],
};

// Fallback geometry for a panel that shipped after the user last saved their
// layout — auto-placed at the bottom of each breakpoint on load.
const APPENDED_PANEL_W = 4;
const APPENDED_PANEL_H = 4;

/**
 * Forward-compat normaliser: ensures every registered panel has a layout item in
 * every breakpoint. A `PanelId` added to `PANELS` after the user last saved is
 * missing from their stored `layouts[bp]`; we append it below the existing items
 * (at its `minW`/`minH`) rather than leave it for RGL to drop at the origin. This
 * lets new panels ship without a data migration. Returns the input unchanged when
 * nothing is missing (referential stability for the common case).
 */
export function ensurePanelsPlaced(config: MapLayoutConfig): MapLayoutConfig {
  let changed = false;
  const layouts = { ...config.layouts };
  for (const bp of Object.keys(PANEL_COLS) as Breakpoint[]) {
    const existing = layouts[bp] ?? [];
    const present = new Set(existing.map((item) => item.i));
    const missing = PANELS.filter((p) => !present.has(p.id));
    if (missing.length === 0) continue;
    changed = true;
    const cols = PANEL_COLS[bp];
    let y = existing.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const appended = missing.map((p) => {
      const item = {
        i: p.id,
        x: 0,
        y,
        w: Math.min(cols, Math.max(p.minW, APPENDED_PANEL_W)),
        h: Math.max(p.minH, APPENDED_PANEL_H),
        minW: p.minW,
        minH: p.minH,
      };
      y += item.h;
      return item;
    });
    layouts[bp] = [...existing, ...appended];
  }
  return changed ? { ...config, layouts } : config;
}
