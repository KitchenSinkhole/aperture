'use client';

import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PANELS } from '@/lib/map/layout/panels';
import { cn } from '@/lib/utils';
import type { PanelGroup, PanelId } from '@/types';

// The grid's `dragConfig.handle` selector targets this class; it sits on the
// whole group header background so dragging anywhere on the header (but the tabs
// and controls, which are `nodrag`) moves the entire cell.
export const PANEL_DRAG_HANDLE_CLASS = 'ap-panel-drag';
// react-draggable's `cancel` selector: pointers starting inside this class never
// begin a drag, so tab switches, dnd-kit tab drags, and header controls stay
// live even though they live on the drag handle.
export const PANEL_NO_DRAG_CLASS = 'nodrag';

const PANEL_TITLES: Record<PanelId, string> = Object.fromEntries(
  PANELS.map((p) => [p.id, p.title]),
) as Record<PanelId, string>;

export interface MapPanelGroupProps {
  group: PanelGroup;
  /** Flat hidden set; a member in it is dropped from the tab strip. */
  hidden: PanelId[];
  onSetActive: (groupId: string, panel: PanelId) => void;
  onHideMember: (panel: PanelId) => void;
  renderContent: (id: PanelId) => ReactNode;
  renderHeaderRight: (id: PanelId) => ReactNode;
  /** Resolves the body class for the active member (canvas needs `overflow-hidden`). */
  contentClassName?: (id: PanelId) => string | undefined;
}

// One tab: a dnd-kit sortable whose id is the member `PanelId` (unique within a
// breakpoint). Dragging reorders within the header or merges onto another group;
// the title button still switches the active tab, the ✕ still hides the member.
function SortableTab({
  member,
  isActive,
  showClose,
  onSetActive,
  onHideMember,
}: {
  member: PanelId;
  isActive: boolean;
  showClose: boolean;
  onSetActive: () => void;
  onHideMember: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: member });
  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex shrink-0 cursor-grab touch-none items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm',
        isActive
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
        isDragging && 'opacity-50',
      )}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        className="truncate font-heading"
        aria-current={isActive}
        onClick={onSetActive}
      >
        {PANEL_TITLES[member]}
      </button>
      {showClose && (
        <button
          type="button"
          aria-label={`Close ${PANEL_TITLES[member]}`}
          className="opacity-60 hover:opacity-100"
          onClick={onHideMember}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

export function MapPanelGroup({
  group,
  hidden,
  onSetActive,
  onHideMember,
  renderContent,
  renderHeaderRight,
  contentClassName,
}: MapPanelGroupProps) {
  const visibleMembers = group.members.filter((m) => !hidden.includes(m));
  const { setNodeRef: setDroppableRef, isOver, active } = useDroppable({
    id: `grp:${group.id}`,
  });
  if (visibleMembers.length === 0) return null;
  const activeMember = visibleMembers.includes(group.active) ? group.active : visibleMembers[0]!;
  const isSingle = visibleMembers.length === 1;
  // Highlight the header as a merge target only when a foreign tab hovers it.
  const isMergeTarget = isOver && active != null && !visibleMembers.includes(active.id as PanelId);

  return (
    <Card className="h-full gap-0 py-0">
      <div
        ref={setDroppableRef}
        className={cn(
          PANEL_DRAG_HANDLE_CLASS,
          'flex shrink-0 cursor-move items-center gap-1.5 border-b px-2 py-1.5',
          isMergeTarget && 'bg-accent ring-2 ring-inset ring-primary',
        )}
      >
        <GripVertical
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-label="Drag panel"
        />
        <div className={cn(PANEL_NO_DRAG_CLASS, 'flex min-w-0 items-center gap-0.5 overflow-x-auto')}>
          <SortableContext items={visibleMembers} strategy={horizontalListSortingStrategy}>
            {visibleMembers.map((m) => (
              <SortableTab
                key={m}
                member={m}
                isActive={m === activeMember}
                showClose={!isSingle}
                onSetActive={() => onSetActive(group.id, m)}
                onHideMember={() => onHideMember(m)}
              />
            ))}
          </SortableContext>
        </div>
        <div className={cn(PANEL_NO_DRAG_CLASS, 'ml-auto flex items-center gap-1')}>
          {renderHeaderRight(activeMember)}
          {isSingle && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Hide ${PANEL_TITLES[activeMember]}`}
              onClick={() => onHideMember(activeMember)}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <div
        className={cn(
          // Card-in-card dedupe: most modules render their own <Card> as the body's
          // direct child. Strip that card's frame (ring + rounded corners) so the
          // panel reads as a single card. The canvas body is a plain div, so this
          // variant simply doesn't match it.
          '[&>[data-slot=card]]:rounded-none [&>[data-slot=card]]:ring-0',
          contentClassName?.(activeMember) ?? 'min-h-0 flex-1 overflow-auto p-0',
        )}
      >
        {renderContent(activeMember)}
      </div>
    </Card>
  );
}
