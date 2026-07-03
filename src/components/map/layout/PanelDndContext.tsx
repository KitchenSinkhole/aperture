'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { type ReactNode, useState } from 'react';

import { PANELS } from '@/lib/map/layout/panels';
import type { PanelId } from '@/types';

import { GRID_DROPPABLE_ID } from './MapLayoutGrid';

const PANEL_TITLES: Record<PanelId, string> = Object.fromEntries(
  PANELS.map((p) => [p.id, p.title]),
) as Record<PanelId, string>;

// `pointerWithin`, but the whole-grid drop surface only wins when the pointer is
// over no group header/tab — so a tab dropped on a header merges/reorders while one
// dropped in open grid space tears off.
const collisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const specific = collisions.filter((c) => c.id !== GRID_DROPPABLE_ID);
  return specific.length > 0 ? specific : collisions;
};

export interface PanelDndContextProps {
  /**
   * Fired when a tab drag settles over a drop target. `activePanel` is the
   * dragged member; `overId` is the raw droppable id — a `grp:<groupId>` header
   * or a bare `PanelId` tab. A drop with no target is swallowed here.
   */
  onDragEnd: (activePanel: PanelId, overId: string) => void;
  children: ReactNode;
}

/**
 * dnd-kit context wrapping the map grid. Tab elements register as draggables and
 * group headers as droppables inside `MapPanelGroup`; this owns the sensors, the
 * pointer-within collision strategy, and the floating drag ghost. Domain-free: it
 * reports the raw active/over ids upward and lets the parent resolve grouping.
 */
export function PanelDndContext({ onDragEnd, children }: PanelDndContextProps) {
  // A 5px threshold keeps a plain tab click a click (fires `onClick` → switch)
  // rather than starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  return (
    <DndContext
      // Stable id so dnd-kit's accessibility `aria-describedby` is deterministic
      // across SSR and hydration (its default id is a module-global counter that
      // diverges between server and client).
      id="map-panel-dnd"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e: DragStartEvent) => setActivePanel(e.active.id as PanelId)}
      onDragCancel={() => setActivePanel(null)}
      onDragEnd={(e: DragEndEvent) => {
        setActivePanel(null);
        if (e.over) onDragEnd(e.active.id as PanelId, String(e.over.id));
      }}
    >
      {children}
      <DragOverlay>
        {activePanel ? (
          <span className="rounded-md border bg-popover px-1.5 py-0.5 font-heading text-sm shadow-md">
            {PANEL_TITLES[activePanel]}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
