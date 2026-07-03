import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_LAYOUT,
  PANELS,
  dedupeGroups,
  ensurePanelsPlaced,
  migrateLayout,
  removePanelFromLayout,
} from '@/lib/map/layout/panels';
import { mapLayoutConfigSchema } from '@/lib/map/layout/schema';
import type { MapLayoutConfig, PanelGroup, StoredMapLayout } from '@/types';

// A minimal pre-v2 blob: geometry only, no `groups`.
function v1Layout(): StoredMapLayout {
  return {
    version: 1,
    layouts: {
      lg: [
        { i: 'canvas', x: 0, y: 0, w: 8, h: 12 },
        { i: 'signatures', x: 0, y: 12, w: 8, h: 6 },
      ],
      md: [{ i: 'canvas', x: 0, y: 0, w: 5, h: 12 }],
      sm: [{ i: 'canvas', x: 0, y: 0, w: 4, h: 10 }],
    },
    hidden: [],
  };
}

describe('migrateLayout', () => {
  it('derives one singleton group per layout item from a v1 blob', () => {
    const migrated = migrateLayout(v1Layout());
    expect(migrated.version).toBe(2);
    expect(migrated.groups.lg).toEqual([
      { id: 'canvas', members: ['canvas'], active: 'canvas' },
      { id: 'signatures', members: ['signatures'], active: 'signatures' },
    ]);
    expect(migrated.groups.md).toEqual([
      { id: 'canvas', members: ['canvas'], active: 'canvas' },
    ]);
    // Every group's active tab is its sole member, whose id is the group id.
    for (const bp of ['lg', 'md', 'sm'] as const) {
      for (const g of migrated.groups[bp]) {
        expect(g.active).toBe(g.members[0]);
        expect(g.id).toBe(g.members[0]);
      }
    }
  });

  it('returns an already-grouped (v2) config unchanged', () => {
    const migrated = migrateLayout(DEFAULT_MAP_LAYOUT);
    expect(migrated.groups).toEqual(DEFAULT_MAP_LAYOUT.groups);
    expect(migrated.version).toBe(2);
  });
});

describe('ensurePanelsPlaced', () => {
  it('back-fills a missing panel as a new singleton group in every breakpoint', () => {
    // Start from a complete v2 layout, then drop one panel everywhere.
    const dropped = PANELS[PANELS.length - 1]!.id;
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    const config: MapLayoutConfig = {
      ...base,
      layouts: {
        lg: base.layouts.lg.filter((i) => i.i !== dropped),
        md: base.layouts.md.filter((i) => i.i !== dropped),
        sm: base.layouts.sm.filter((i) => i.i !== dropped),
      },
      groups: {
        lg: base.groups.lg.filter((g) => g.id !== dropped),
        md: base.groups.md.filter((g) => g.id !== dropped),
        sm: base.groups.sm.filter((g) => g.id !== dropped),
      },
    };

    const placed = ensurePanelsPlaced(config);
    for (const bp of ['lg', 'md', 'sm'] as const) {
      expect(placed.layouts[bp].some((i) => i.i === dropped)).toBe(true);
      expect(placed.groups[bp]).toContainEqual({
        id: dropped,
        members: [dropped],
        active: dropped,
      });
    }
  });

  it('is referentially stable when nothing is missing', () => {
    const complete = migrateLayout(DEFAULT_MAP_LAYOUT);
    expect(ensurePanelsPlaced(complete)).toBe(complete);
  });

  it('does not re-add a hidden panel', () => {
    const dropped = PANELS[PANELS.length - 1]!.id;
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    const config: MapLayoutConfig = {
      ...base,
      hidden: [dropped],
      layouts: {
        lg: base.layouts.lg.filter((i) => i.i !== dropped),
        md: base.layouts.md.filter((i) => i.i !== dropped),
        sm: base.layouts.sm.filter((i) => i.i !== dropped),
      },
      groups: {
        lg: base.groups.lg.filter((g) => g.id !== dropped),
        md: base.groups.md.filter((g) => g.id !== dropped),
        sm: base.groups.sm.filter((g) => g.id !== dropped),
      },
    };
    const placed = ensurePanelsPlaced(config);
    for (const bp of ['lg', 'md', 'sm'] as const) {
      expect(placed.layouts[bp].some((i) => i.i === dropped)).toBe(false);
      expect(placed.groups[bp].some((g) => g.members.includes(dropped))).toBe(false);
    }
  });

  it('does not re-add a tabbed member that has no layout item of its own', () => {
    // `route` tabbed into the `systemKillboard` group on lg: it's a group member
    // but not a layout item id. It must not be resurrected as a duplicate cell.
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    const config: MapLayoutConfig = {
      ...base,
      layouts: { ...base.layouts, lg: base.layouts.lg.filter((i) => i.i !== 'route') },
      groups: {
        ...base.groups,
        lg: base.groups.lg
          .filter((g) => g.id !== 'route')
          .map((g) =>
            g.id === 'systemKillboard'
              ? { id: 'systemKillboard', members: ['systemKillboard', 'route'], active: 'route' }
              : g,
          ),
      },
    };
    const placed = ensurePanelsPlaced(config);
    expect(placed.layouts.lg.some((i) => i.i === 'route')).toBe(false);
    const routeGroups = placed.groups.lg.filter((g) => g.members.includes('route'));
    expect(routeGroups).toHaveLength(1);
    expect(routeGroups[0]!.id).toBe('systemKillboard');
  });
});

describe('dedupeGroups', () => {
  // `route` properly tabbed into `systemKillboard`, then resurrected as a trailing
  // standalone cell — the corruption a stale `ensurePanelsPlaced` appended on load.
  function duplicated(): MapLayoutConfig {
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    const tabbedGroups: PanelGroup[] = base.groups.lg
      .filter((g) => g.id !== 'route')
      .map((g) =>
        g.id === 'systemKillboard'
          ? { id: 'systemKillboard', members: ['systemKillboard', 'route'], active: 'route' }
          : g,
      );
    const tabbedItems = base.layouts.lg.filter((i) => i.i !== 'route');
    return {
      ...base,
      layouts: {
        ...base.layouts,
        lg: [...tabbedItems, { i: 'route', x: 0, y: 99, w: 4, h: 4, minW: 2, minH: 2 }],
      },
      groups: {
        ...base.groups,
        lg: [...tabbedGroups, { id: 'route', members: ['route'], active: 'route' }],
      },
    };
  }

  it('strips a later duplicate membership, keeping the first occurrence', () => {
    const deduped = dedupeGroups(duplicated());
    const routeGroups = deduped.groups.lg.filter((g) => g.members.includes('route'));
    expect(routeGroups).toHaveLength(1);
    // The tabbed membership (earlier in group order) wins; the standalone
    // `route` singleton group and its grid item are dropped.
    expect(routeGroups[0]!.id).toBe('systemKillboard');
    expect(deduped.groups.lg.some((g) => g.id === 'route')).toBe(false);
    expect(deduped.layouts.lg.some((i) => i.i === 'route')).toBe(false);
    // Every panel now appears exactly once across the breakpoint's groups.
    const members = deduped.groups.lg.flatMap((g) => g.members);
    expect(new Set(members).size).toBe(members.length);
  });

  it('is referentially stable when no panel is duplicated', () => {
    const clean = migrateLayout(DEFAULT_MAP_LAYOUT);
    expect(dedupeGroups(clean)).toBe(clean);
  });
});

describe('removePanelFromLayout', () => {
  // A 2-member group on lg (`canvas` anchor + `signatures`), singletons on md/sm.
  function tabbed(): MapLayoutConfig {
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    return {
      ...base,
      layouts: {
        ...base.layouts,
        lg: base.layouts.lg.filter((i) => i.i !== 'signatures'),
      },
      groups: {
        ...base.groups,
        lg: [
          { id: 'canvas', members: ['canvas', 'signatures'], active: 'signatures' },
          ...base.groups.lg.filter((g) => g.id !== 'canvas' && g.id !== 'signatures'),
        ],
      },
    };
  }

  it('removes a non-anchor member and picks a new active without touching geometry', () => {
    const config = tabbed();
    const lgItems = config.layouts.lg.length;
    const next = removePanelFromLayout(config, 'signatures');
    const group = next.groups.lg.find((g) => g.id === 'canvas')!;
    expect(group.members).toEqual(['canvas']);
    expect(group.active).toBe('canvas');
    // The group's grid item is untouched — a surviving group keeps its cell.
    expect(next.layouts.lg.length).toBe(lgItems);
  });

  it('re-keys the group and its grid item when the removed member is the anchor id', () => {
    const config = tabbed();
    const next = removePanelFromLayout(config, 'canvas');
    // Group id must stay one of its members, so it re-keys to `signatures`.
    expect(next.groups.lg.some((g) => g.id === 'canvas')).toBe(false);
    const group = next.groups.lg.find((g) => g.members.includes('signatures'))!;
    expect(group.id).toBe('signatures');
    expect(group.members).toEqual(['signatures']);
    expect(next.layouts.lg.some((i) => i.i === 'canvas')).toBe(false);
    expect(next.layouts.lg.some((i) => i.i === 'signatures')).toBe(true);
  });

  it('drops the group and its grid item when the sole member is removed', () => {
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    const next = removePanelFromLayout(base, 'canvas');
    for (const bp of ['lg', 'md', 'sm'] as const) {
      expect(next.groups[bp].some((g) => g.members.includes('canvas'))).toBe(false);
      expect(next.layouts[bp].some((i) => i.i === 'canvas')).toBe(false);
    }
  });

  it('is referentially stable when the panel is in no group', () => {
    const base = migrateLayout(DEFAULT_MAP_LAYOUT);
    const once = removePanelFromLayout(base, 'canvas');
    expect(removePanelFromLayout(once, 'canvas')).toBe(once);
  });
});

describe('mapLayoutConfigSchema', () => {
  it('accepts a legacy blob with no groups (optional)', () => {
    expect(mapLayoutConfigSchema.safeParse(v1Layout()).success).toBe(true);
  });

  it('accepts a valid tabbed group', () => {
    const config = {
      ...v1Layout(),
      groups: {
        lg: [{ id: 'grp1', members: ['canvas', 'signatures'], active: 'signatures' }],
        md: [],
        sm: [],
      },
    };
    expect(mapLayoutConfigSchema.safeParse(config).success).toBe(true);
  });

  it('rejects a group whose active tab is not a member', () => {
    const config = {
      ...v1Layout(),
      groups: {
        lg: [{ id: 'grp1', members: ['canvas'], active: 'signatures' }],
        md: [],
        sm: [],
      },
    };
    expect(mapLayoutConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects a group with duplicate members', () => {
    const config = {
      ...v1Layout(),
      groups: {
        lg: [{ id: 'grp1', members: ['canvas', 'canvas'], active: 'canvas' }],
        md: [],
        sm: [],
      },
    };
    expect(mapLayoutConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects a group referencing an unknown panel', () => {
    const config = {
      ...v1Layout(),
      groups: {
        lg: [{ id: 'grp1', members: ['canvas', 'bogus'], active: 'canvas' }],
        md: [],
        sm: [],
      },
    };
    expect(mapLayoutConfigSchema.safeParse(config).success).toBe(false);
  });
});
