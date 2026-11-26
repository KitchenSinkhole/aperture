import type { Layout } from 'react-grid-layout';

/** Grid rows for an experimental collapsed panel (header chrome only). */
export const EXPERIMENTAL_COLLAPSED_PANEL_H = 1;

/**
 * Adjusts the active breakpoint layout when an experimental panel group collapses
 * or expands: shrinks `h` to {@link EXPERIMENTAL_COLLAPSED_PANEL_H}, shifts items
 * below up (or back down on expand). Does not touch persisted layout — callers
 * set `layoutPersistSkipRef` before applying.
 */
export function applyExperimentalPanelCollapse(
  items: Layout,
  groupId: string,
  collapsed: boolean,
  savedHeights: Map<string, number>,
): Layout | null {
  const target = items.find((it) => it.i === groupId);
  if (!target) return null;

  if (collapsed) {
    if (target.h <= EXPERIMENTAL_COLLAPSED_PANEL_H) return null;
    savedHeights.set(groupId, target.h);
    const oldBottom = target.y + target.h;
    const delta = target.h - EXPERIMENTAL_COLLAPSED_PANEL_H;
    return items.map((it) => {
      if (it.i === groupId) return { ...it, h: EXPERIMENTAL_COLLAPSED_PANEL_H };
      if (it.y >= oldBottom) return { ...it, y: it.y - delta };
      return it;
    });
  }

  const restoreH = savedHeights.get(groupId);
  if (restoreH == null || target.h === restoreH) return null;
  savedHeights.delete(groupId);
  const collapsedBottom = target.y + target.h;
  const delta = restoreH - target.h;
  return items.map((it) => {
    if (it.i === groupId) return { ...it, h: restoreH };
    if (it.y >= collapsedBottom) return { ...it, y: it.y + delta };
    return it;
  });
}
