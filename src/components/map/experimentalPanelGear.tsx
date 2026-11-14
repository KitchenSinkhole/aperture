'use client';

import { Settings2 } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import type { PanelId } from '@/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const GEAR_PANELS: ReadonlySet<PanelId> = new Set(['canvas', 'route', 'pilots']);

export type ExperimentalPanelGearSlotProps = {
  panelId: PanelId;
};

type ExperimentalPanelGearContextValue = {
  renderGearBody: (panelId: PanelId) => ReactNode;
};

const ExperimentalPanelGearContext = createContext<ExperimentalPanelGearContextValue | null>(null);

export function ExperimentalPanelGearProvider({
  renderGearBody,
  children,
}: {
  renderGearBody: (panelId: PanelId) => ReactNode;
  children: ReactNode;
}) {
  return (
    <ExperimentalPanelGearContext.Provider value={{ renderGearBody }}>
      {children}
    </ExperimentalPanelGearContext.Provider>
  );
}

export function ExperimentalPanelGear({ panelId }: ExperimentalPanelGearSlotProps) {
  const ctx = useContext(ExperimentalPanelGearContext);
  if (!ctx || !GEAR_PANELS.has(panelId)) return null;
  const body = ctx.renderGearBody(panelId);
  if (body == null) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="nodrag"
            aria-label="Panel settings"
          >
            <Settings2 className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent className="w-56 p-2 text-xs">{body}</PopoverContent>
    </Popover>
  );
}

export function experimentalPanelSupportsGear(panelId: PanelId): boolean {
  return GEAR_PANELS.has(panelId);
}
