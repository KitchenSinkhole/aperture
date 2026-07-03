import type { Layout } from 'react-grid-layout';
import type { Breakpoint, MapLayoutConfig, PanelGroup, PanelId, StoredMapLayout } from '@/types';

// Single source of truth for the map dashboard's panels and their default
// arrangement. `DEFAULT_MAP_LAYOUT` is the built-in fixed two-column layout:
// a tall canvas top-left with full-width signatures beneath it, and the info
// modules stacked in a right column.

/** Bumped when the stored shape changes incompatibly; gates a reset/migration. */
export const LAYOUT_CONFIG_VERSION = 2;

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

/** One singleton `PanelGroup` per layout item — its id is the item's `PanelId`. */
function singletonGroups(items: Layout): PanelGroup[] {
  return items.map((item) => {
    const id = item.i as PanelId;
    return { id, members: [id], active: id };
  });
}

const defaultLayouts: Record<Breakpoint, Layout> = {
  lg: wideLayout(12),
  md: wideLayout(8),
  sm: stackedLayout,
};

export const DEFAULT_MAP_LAYOUT: MapLayoutConfig = {
  version: LAYOUT_CONFIG_VERSION,
  layouts: defaultLayouts,
  groups: {
    lg: singletonGroups(defaultLayouts.lg),
    md: singletonGroups(defaultLayouts.md),
    sm: singletonGroups(defaultLayouts.sm),
  },
  hidden: [],
};

// Fallback geometry for a panel that shipped after the user last saved their
// layout — auto-placed at the bottom of each breakpoint on load.
const APPENDED_PANEL_W = 4;
const APPENDED_PANEL_H = 4;

/**
 * Forward-compat normaliser: ensures every registered, non-hidden panel has a
 * layout item in every breakpoint. A `PanelId` added to `PANELS` after the user
 * last saved is missing from their stored `layouts[bp]`; we append it below the
 * existing items (at its `minW`/`minH`) rather than leave it for RGL to drop at
 * the origin. This lets new panels ship without a data migration, and doubles as
 * the "re-show" placement: a panel dropped from `hidden` reappears here as a fresh
 * singleton group. A panel still in `hidden` is skipped, so hiding (which removes
 * its layout item) survives reloads. Returns the input unchanged when nothing is
 * missing (referential stability for the common case).
 */
export function ensurePanelsPlaced(config: MapLayoutConfig): MapLayoutConfig {
  let changed = false;
  const layouts = { ...config.layouts };
  const groups = { ...config.groups };
  const hidden = new Set(config.hidden);
  for (const bp of Object.keys(PANEL_COLS) as Breakpoint[]) {
    const existing = layouts[bp] ?? [];
    // A panel is "placed" if it's a member of any group in this breakpoint. A
    // tabbed member shares its group's grid item and has no layout id of its own,
    // so keying on layout item ids alone would wrongly treat it as missing and
    // re-add it as a duplicate standalone cell on every reload.
    const present = new Set((groups[bp] ?? []).flatMap((g) => g.members));
    const missing = PANELS.filter((p) => !present.has(p.id) && !hidden.has(p.id));
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
    groups[bp] = [...(groups[bp] ?? []), ...singletonGroups(appended)];
  }
  return changed ? { ...config, layouts, groups } : config;
}

/**
 * Version normaliser: upgrades a stored blob to the current
 * `LAYOUT_CONFIG_VERSION`. A v1 blob has no `groups`; for each breakpoint we
 * derive one singleton group per layout item (id === its `PanelId`), so the
 * arrangement is preserved and every panel becomes its own untabbed cell. Reads
 * `config.groups` defensively — a v1 jsonb blob cast to `MapLayoutConfig` has it
 * absent at runtime. Returns the input unchanged when it already carries groups.
 */
export function migrateLayout(config: StoredMapLayout): MapLayoutConfig {
  if (config.groups) return { ...config, groups: config.groups };
  const groups = {} as Record<Breakpoint, PanelGroup[]>;
  for (const bp of Object.keys(PANEL_COLS) as Breakpoint[]) {
    groups[bp] = singletonGroups(config.layouts[bp] ?? []);
  }
  return { ...config, version: LAYOUT_CONFIG_VERSION, groups };
}

/**
 * Remove a panel from the group model in every breakpoint. The panel leaves its
 * group's tab strip; if it was the active tab a sibling takes over, if it was the
 * group's anchor id the group and its grid item are re-keyed to a surviving
 * member (a group id must always be one of its members), and if it was the sole
 * member the group and its grid item are dropped. Surviving groups keep their
 * geometry. Used by hide — the panel then lands in `hidden`, and `ensurePanelsPlaced`
 * re-adds it as a fresh singleton on show. Returns the input unchanged when the
 * panel is in no group.
 */
export function removePanelFromLayout(config: MapLayoutConfig, panel: PanelId): MapLayoutConfig {
  let changed = false;
  const layouts = { ...config.layouts };
  const groups = { ...config.groups };
  for (const bp of Object.keys(PANEL_COLS) as Breakpoint[]) {
    const groupsBp = config.groups[bp] ?? [];
    const source = groupsBp.find((g) => g.members.includes(panel));
    if (!source) continue;
    changed = true;
    const droppedIds = new Set<string>();
    const renamed = new Map<string, PanelId>();
    groups[bp] = groupsBp.flatMap((g) => {
      if (g.id !== source.id) return [g];
      const members = g.members.filter((m) => m !== panel);
      if (members.length === 0) {
        droppedIds.add(g.id);
        return [];
      }
      const active = g.active === panel ? members[0]! : g.active;
      if (g.id === panel) {
        renamed.set(g.id, active);
        return [{ id: active, members, active }];
      }
      return [{ ...g, members, active }];
    });
    if (droppedIds.size > 0 || renamed.size > 0) {
      layouts[bp] = (config.layouts[bp] ?? [])
        .filter((it) => !droppedIds.has(it.i))
        .map((it) => {
          const newId = renamed.get(it.i);
          return newId ? { ...it, i: newId, ...PANEL_MIN[newId] } : it;
        });
    }
  }
  return changed ? { ...config, layouts, groups } : config;
}

/**
 * Repair normaliser: enforces the invariant that a panel is a member of at most
 * one group per breakpoint. The first occurrence (in `groups[bp]` order) wins;
 * later duplicate memberships are stripped. A group emptied by de-duplication is
 * dropped along with its grid item; a group whose anchor id was a stripped
 * duplicate is re-keyed to a surviving member. Heals layouts saved while
 * `ensurePanelsPlaced` keyed placement off layout ids (which resurrected a tabbed
 * member as a second standalone cell). Returns the input unchanged when every
 * panel already appears once.
 */
export function dedupeGroups(config: MapLayoutConfig): MapLayoutConfig {
  let changed = false;
  const layouts = { ...config.layouts };
  const groups = { ...config.groups };
  for (const bp of Object.keys(PANEL_COLS) as Breakpoint[]) {
    const seen = new Set<PanelId>();
    const droppedIds = new Set<string>();
    const renamed = new Map<string, PanelId>();
    let bpChanged = false;
    const nextGroupsBp = (config.groups[bp] ?? []).flatMap((g) => {
      const members = g.members.filter((m) => {
        if (seen.has(m)) return false;
        seen.add(m);
        return true;
      });
      if (members.length === g.members.length) return [g];
      bpChanged = true;
      if (members.length === 0) {
        droppedIds.add(g.id);
        return [];
      }
      const active = members.includes(g.active) ? g.active : members[0]!;
      if (!members.includes(g.id as PanelId)) {
        renamed.set(g.id, active);
        return [{ id: active, members, active }];
      }
      return [{ ...g, members, active }];
    });
    if (!bpChanged) continue;
    changed = true;
    groups[bp] = nextGroupsBp;
    if (droppedIds.size > 0 || renamed.size > 0) {
      layouts[bp] = (config.layouts[bp] ?? [])
        .filter((it) => !droppedIds.has(it.i))
        .map((it) => {
          const newId = renamed.get(it.i);
          return newId ? { ...it, i: newId, ...PANEL_MIN[newId] } : it;
        });
    }
  }
  return changed ? { ...config, layouts, groups } : config;
}
