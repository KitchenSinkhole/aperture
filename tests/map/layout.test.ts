import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_LAYOUT,
  PANELS,
  ensurePanelsPlaced,
  migrateLayout,
} from '@/lib/map/layout/panels';
import { mapLayoutConfigSchema } from '@/lib/map/layout/schema';
import type { MapLayoutConfig, StoredMapLayout } from '@/types';

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
});
