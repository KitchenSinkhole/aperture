'use client';

import 'react-grid-layout/css/styles.css';

import { useDndMonitor, useDroppable, type DragMoveEvent } from '@dnd-kit/core';
import {
  Responsive as ResponsiveGridLayout,
  calcGridItemPosition,
  calcXY,
  useContainerWidth,
  type Layout,
  type ResponsiveLayouts,
} from 'react-grid-layout';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { PANEL_BREAKPOINTS, PANEL_COLS, PANEL_MIN } from '@/lib/map/layout/panels';
import type { Breakpoint, PanelId } from '@/types';

import { PANEL_DRAG_HANDLE_CLASS, PANEL_NO_DRAG_CLASS } from './MapPanelGroup';

// Pixel height of one grid row; a layout item's `h` multiplies this.
const ROW_HEIGHT = 40;
// [horizontal, vertical] gap between grid items, in px. Also used as the grid's
// `containerPadding` so RGL's own placement math (reused for the tear-off ghost)
// is fully determined by these constants rather than RGL's implicit default.
const GRID_MARGIN: [number, number] = [8, 8];

// dnd-kit droppable id for the whole grid surface — a tab dropped here (outside any
// group header) tears off into its own cell. Shared with `PanelDndContext`, whose
// collision detection deprioritises it so headers/tabs win when the pointer is over
// one.
export const GRID_DROPPABLE_ID = 'grid-surface';

// The snapped cell a torn-off tab would land in, in grid units, while dragging over
// the grid surface.
interface GhostCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayoutGridProps {
  /** Per-breakpoint arrangements; each item's `i` matches a child's `key`. */
  layouts: Record<Breakpoint, Layout>;
  /** RGL fires this on every drag/resize with the active + all-breakpoint layouts. */
  onLayoutChange: (current: Layout, all: ResponsiveLayouts<Breakpoint>) => void;
  /** Fires when the measured width crosses into a new breakpoint (and once mounted). */
  onBreakpointChange?: (bp: Breakpoint) => void;
  /** Fires when a tab is dropped on the open grid, with the snapped target cell. */
  onTearOff?: (panel: PanelId, x: number, y: number) => void;
  /** One element per visible group, each keyed by its group id. */
  children: ReactNode;
}

export function MapLayoutGrid({
  layouts,
  onLayoutChange,
  onBreakpointChange,
  onTearOff,
  children,
}: MapLayoutGridProps) {
  // ResizeObserver-based width (replaces the SSR-hostile WidthProvider). `mounted`
  // gates the grid until a real width is measured, avoiding a hydration flash.
  const { width, containerRef, mounted } = useContainerWidth();

  // The whole grid area is a dnd-kit drop target; its ref is merged onto the same
  // container the ResizeObserver measures so the droppable rect equals the grid.
  const { setNodeRef: setDroppableRef } = useDroppable({ id: GRID_DROPPABLE_ID });
  const setContainerRefs = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      setDroppableRef(node);
    },
    [containerRef, setDroppableRef],
  );

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

  const cols = PANEL_COLS[currentBreakpoint];
  const positionParams = useMemo(
    () => ({
      margin: GRID_MARGIN,
      containerPadding: GRID_MARGIN,
      containerWidth: width,
      cols,
      rowHeight: ROW_HEIGHT,
      maxRows: Infinity,
    }),
    [width, cols],
  );

  // The snapped cell a tab would tear off into. Non-null only while a tab hovers the
  // grid surface (outside any header); drives the ghost outline.
  const [ghost, setGhost] = useState<GhostCell | null>(null);

  // Translate the live pointer (activator + accumulated delta) to a snapped grid
  // cell for the dragged panel, using the panel's `PANEL_MIN` footprint.
  const pointerCell = useCallback(
    (e: DragMoveEvent): GhostCell | null => {
      const node = containerRef.current;
      const activator = e.activatorEvent as PointerEvent;
      if (!node || activator == null) return null;
      const rect = node.getBoundingClientRect();
      const panel = e.active.id as PanelId;
      const min = PANEL_MIN[panel];
      if (!min) return null;
      const w = Math.min(cols, min.minW);
      const h = min.minH;
      const left = activator.clientX + e.delta.x - rect.left;
      const top = activator.clientY + e.delta.y - rect.top;
      const { x, y } = calcXY(positionParams, top, left, w, h);
      return { x, y, w, h };
    },
    [containerRef, cols, positionParams],
  );

  useDndMonitor({
    onDragMove: (e) => {
      setGhost(e.over?.id === GRID_DROPPABLE_ID ? pointerCell(e) : null);
    },
    onDragEnd: (e) => {
      if (e.over?.id === GRID_DROPPABLE_ID) {
        const cell = pointerCell(e);
        if (cell) onTearOff?.(e.active.id as PanelId, cell.x, cell.y);
      }
      setGhost(null);
    },
    onDragCancel: () => setGhost(null),
  });

  const ghostRect = ghost && calcGridItemPosition(positionParams, ghost.x, ghost.y, ghost.w, ghost.h);

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
    <div ref={setContainerRefs} className="relative h-full w-full">
      {mounted ? (
        <ResponsiveGridLayout<Breakpoint>
          width={width}
          breakpoints={PANEL_BREAKPOINTS}
          cols={PANEL_COLS}
          layouts={constrainedLayouts}
          rowHeight={ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={GRID_MARGIN}
          dragConfig={dragConfig}
          onLayoutChange={onLayoutChange}
        >
          {children}
        </ResponsiveGridLayout>
      ) : (
        // First paint before measurement: a plain stacked fallback.
        <div className="flex flex-col gap-2">{children}</div>
      )}
      {ghostRect && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 rounded-md border-2 border-dashed border-primary bg-primary/10"
          style={{
            left: ghostRect.left,
            top: ghostRect.top,
            width: ghostRect.width,
            height: ghostRect.height,
          }}
        />
      )}
    </div>
  );
}
