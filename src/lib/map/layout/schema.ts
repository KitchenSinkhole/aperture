import { z } from 'zod';
import type { PanelId, StoredMapLayout } from '@/types';
import { PANELS } from './panels';

// System boundary: the layout config is user-supplied JSON (posted by the grid's
// debounced save) before it lands in `ap_user.map_layout`. Validate the whole
// shape with bounded numeric ranges; unknown item keys (RGL's `static`, `moved`,
// `maxW`, …) are stripped — only the minimal geometry is persisted.

const panelId = z.enum(PANELS.map((p) => p.id) as [PanelId, ...PanelId[]]);

const COORD = z.number().int().min(0).max(1000);
const SPAN = z.number().int().min(1).max(1000);

const layoutItem = z.object({
  i: panelId,
  x: COORD,
  y: COORD,
  w: SPAN,
  h: SPAN,
  minW: COORD.optional(),
  minH: COORD.optional(),
});

const breakpointLayout = z.array(layoutItem).max(50);

const panelGroup = z
  .object({
    id: z.string().min(1).max(100),
    members: z.array(panelId).min(1).max(50),
    active: panelId,
  })
  .refine((g) => new Set(g.members).size === g.members.length, {
    message: 'group members must be unique',
  })
  .refine((g) => g.members.includes(g.active), {
    message: 'active tab must be a group member',
  });

const breakpointGroups = z
  .array(panelGroup)
  .max(50)
  .refine(
    (groups) => {
      const seen = new Set<PanelId>();
      for (const g of groups) {
        for (const m of g.members) {
          if (seen.has(m)) return false;
          seen.add(m);
        }
      }
      return true;
    },
    { message: 'a panel may belong to at most one group per breakpoint' },
  );

export const mapLayoutConfigSchema = z.object({
  version: z.number().int().min(0).max(1_000_000),
  layouts: z.object({
    lg: breakpointLayout,
    md: breakpointLayout,
    sm: breakpointLayout,
  }),
  // Optional so a legacy v1 file (no grouping) still parses; `migrateLayout`
  // derives singleton groups after this boundary.
  groups: z
    .object({
      lg: breakpointGroups,
      md: breakpointGroups,
      sm: breakpointGroups,
    })
    .optional(),
  hidden: z.array(panelId).max(50),
});

// Compile-time guarantee the parser's output is a valid pre-normalisation layout
// (`groups` optional here; `migrateLayout` fills it before it becomes a
// `MapLayoutConfig`).
export type ParsedMapLayout = z.infer<typeof mapLayoutConfigSchema>;
type _AssignableToStored = ParsedMapLayout extends StoredMapLayout ? true : never;
const _check: _AssignableToStored = true;
void _check;
