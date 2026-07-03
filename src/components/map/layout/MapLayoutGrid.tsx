'use client';

import 'react-grid-layout/css/styles.css';

import {
  Responsive as ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from 'react-grid-layout';
import { type ReactNode, useEffect, useMemo } from 'react';

import { PANEL_BREAKPOINTS, PANEL_COLS, PANEL_MIN } from '@/lib/map/layout/panels';
import type { Breakpoint, PanelId } from '@/types';

import { PANEL_DRAG_HANDLE_CLASS, PANEL_NO_DRAG_CLASS } from './MapPanelGroup';

// Pixel height of one grid row; a layout item's `h` multiplies this.
const ROW_HEIGHT = 40;
// [horizontal, vertical] gap between grid items, in px.
const GRID_MARGIN: readonly [number, number] = [8, 8];

export interface MapLayoutGridProps {
  /** Per-breakpoint arrangements; each item's `i` matches a child's `key`. */
  layouts: Record<Breakpoint, Layout>;
  /** RGL fires this on every drag/resize with the active + all-breakpoint layouts. */
  onLayoutChange: (current: Layout, all: ResponsiveLayouts<Breakpoint>) => void;
  /** Fires when the measured width crosses into a new breakpoint (and once mounted). */
  onBreakpointChange?: (bp: Breakpoint) => void;
  /** One element per visible group, each keyed by its group id. */
  children: ReactNode;
}

export function MapLayoutGrid({
  layouts,
  onLayoutChange,
  onBreakpointChange,
  children,
}: MapLayoutGridProps) {
  // ResizeObserver-based width (replaces the SSR-hostile WidthProvider). `mounted`
  // gates the grid until a real width is measured, avoiding a hydration flash.
  const { width, containerRef, mounted } = useContainerWidth();

  // The active breakpoint: the largest whose min-width fits the measured width.
  // Reported upward so the parent can pick the matching per-breakpoint grouping;
  // computed here (not from RGL's own callback) so the initial value is definite.
  const currentBreakpoint = useMemo<Breakpoint>(() => {
    const ordered = (Object.keys(PANEL_BREAKPOINTS) as Breakpoint[]).sort(
      (a, b) => PANEL_BREAKPOINTS[b] - PANEL_BREAKPOINTS[a],
    );
    return ordered.find((bp) => width >= PANEL_BREAKPOINTS[bp]) ?? 'sm';
  }, [width]);

  useEffect(() => {
    if (mounted) onBreakpointChange?.(currentBreakpoint);
  }, [mounted, currentBreakpoint, onBreakpointChange]);

  const dragConfig = useMemo(
    () => ({ handle: `.${PANEL_DRAG_HANDLE_CLASS}`, cancel: `.${PANEL_NO_DRAG_CLASS}` }),
    [],
  );

  // Re-apply the registry resize floors over the stored layout so `PANEL_MIN`
  // stays authoritative — lowering a panel's `minW`/`minH` in the registry takes
  // effect for already-saved layouts without touching their persisted positions.
  const constrainedLayouts = useMemo(() => {
    const out = {} as Record<Breakpoint, Layout>;
    for (const bp of Object.keys(layouts) as Breakpoint[]) {
      out[bp] = layouts[bp].map((item) => {
        const min = PANEL_MIN[item.i as PanelId];
        return min ? { ...item, minW: min.minW, minH: min.minH } : item;
      });
    }
    return out;
  }, [layouts]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {mounted ? (
        <ResponsiveGridLayout<Breakpoint>
          width={width}
          breakpoints={PANEL_BREAKPOINTS}
          cols={PANEL_COLS}
          layouts={constrainedLayouts}
          rowHeight={ROW_HEIGHT}
          margin={GRID_MARGIN}
          dragConfig={dragConfig}
          onLayoutChange={onLayoutChange}
        >
          {children}
        </ResponsiveGridLayout>
      ) : (
        // First paint before measurement: a plain stacked fallback.
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </div>
  );
}
