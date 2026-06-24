'use client';

import { Lock } from 'lucide-react';
import { Tooltip } from '@base-ui/react/tooltip';
import type { NodeProps } from '@xyflow/react';
import type { MapNote } from '@/lib/map/loadMap';
import { noteSeverityColor } from './styling';
import { NoteContent } from './NoteContent';

// Free-standing map note. A severity-coloured card carrying a short title (the
// on-node label) and an optional longer body shown as a hover tooltip. Notes
// don't connect, so — unlike SystemNode — there are no xyflow handles. Editing
// lives entirely in the sidebar inspector; double-click selects the note and
// opens it there.

export type MapNoteNodeData = MapNote & {
  /** Wired by `MapCanvas`; absent on the read-only path. Selects this note → inspector. */
  onOpen?: (id: string) => void;
};

export function MapNoteNode({
  data,
  selected,
}: NodeProps & { data: MapNoteNodeData }) {
  const color = noteSeverityColor(data.severity);

  // Mirror SystemNode's selection treatment: a resting severity-coloured ring,
  // a brighter halo when selected, and a soft drop shadow for slight elevation.
  const boxShadow = [
    `0 0 0 1px ${color}`,
    selected ? `0 0 0 4px ${color}40, 0 0 16px 3px ${color}cc` : '',
    '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  ]
    .filter(Boolean)
    .join(', ');

  const body = (
    <div
      className="group relative min-w-30 max-w-60 cursor-pointer rounded-md bg-map-node px-2 py-1.5 text-xs text-card-foreground transition-[box-shadow,outline,transform] duration-50"
      style={{
        borderLeft: `4px solid ${color}`,
        outline: selected ? `2px solid ${color}` : 'none',
        outlineOffset: selected ? '3px' : undefined,
        boxShadow,
        transform: selected ? 'scale(1.01)' : undefined,
      }}
      onDoubleClick={(e) => {
        // Stop xyflow's pane double-click zoom from also firing.
        e.stopPropagation();
        data.onOpen?.(data.id);
      }}
    >
      <div className="flex items-center gap-1">
        <span className="flex-1 truncate font-mono text-lg font-bold leading-none">{data.title}</span>
        {data.locked && <Lock className="size-3 shrink-0 text-muted-foreground" />}
      </div>
      {data.content && (
        <NoteContent
          content={data.content}
          className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground"
        />
      )}
    </div>
  );

  // No body to expand → render the bare card (the tooltip would be empty).
  if (!data.content) return body;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<div />}>{body}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 max-w-[20rem] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            <NoteContent content={data.content} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
