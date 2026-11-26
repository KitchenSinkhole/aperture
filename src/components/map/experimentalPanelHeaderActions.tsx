'use client';

import { Plus } from 'lucide-react';
import type { PanelId } from '@/types';
import { Button } from '@/components/ui/button';
import { requestExperimentalPanelAdd } from '@/lib/experimentalPanelActionBus';

const ADD_PANELS: ReadonlySet<PanelId> = new Set([
  'route',
  'pilots',
  'kills',
  'dscan',
  'thera',
  'inspector',
]);

export function experimentalPanelSupportsAdd(panelId: PanelId): boolean {
  return ADD_PANELS.has(panelId);
}

/** Experimental **+ Add** control for `MapPanelGroup` headers. */
export function ExperimentalPanelAddButton({ panelId }: { panelId: PanelId }) {
  if (!ADD_PANELS.has(panelId)) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="nodrag h-7 gap-1 px-2 text-xs"
      onClick={() => requestExperimentalPanelAdd(panelId)}
    >
      <Plus className="size-3" />
      Add
    </Button>
  );
}
