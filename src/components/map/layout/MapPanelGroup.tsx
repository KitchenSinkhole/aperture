'use client';

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
// begin a drag, so tab switches and header controls stay clickable even though
// they live on the drag handle.
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
  if (visibleMembers.length === 0) return null;
  const active = visibleMembers.includes(group.active) ? group.active : visibleMembers[0]!;
  const isSingle = visibleMembers.length === 1;

  return (
    <Card className="h-full gap-0 py-0">
      <div
        className={cn(
          PANEL_DRAG_HANDLE_CLASS,
          'flex shrink-0 cursor-move items-center gap-1.5 border-b px-2 py-1.5',
        )}
      >
        <GripVertical
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-label="Drag panel"
        />
        {isSingle ? (
          <span className="truncate font-heading text-sm font-medium">{PANEL_TITLES[active]}</span>
        ) : (
          <div
            className={cn(PANEL_NO_DRAG_CLASS, 'flex min-w-0 items-center gap-0.5 overflow-x-auto')}
          >
            {visibleMembers.map((m) => {
              const isActive = m === active;
              return (
                <span
                  key={m}
                  className={cn(
                    'flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm',
                    isActive
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <button
                    type="button"
                    className="truncate font-heading"
                    aria-current={isActive}
                    onClick={() => onSetActive(group.id, m)}
                  >
                    {PANEL_TITLES[m]}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${PANEL_TITLES[m]}`}
                    className="opacity-60 hover:opacity-100"
                    onClick={() => onHideMember(m)}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className={cn(PANEL_NO_DRAG_CLASS, 'ml-auto flex items-center gap-1')}>
          {renderHeaderRight(active)}
          {isSingle && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Hide ${PANEL_TITLES[active]}`}
              onClick={() => onHideMember(active)}
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
          contentClassName?.(active) ?? 'min-h-0 flex-1 overflow-auto p-0',
        )}
      >
        {renderContent(active)}
      </div>
    </Card>
  );
}
