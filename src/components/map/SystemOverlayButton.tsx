'use client';

import { createPortal } from 'react-dom';
import { PictureInPicture2 } from 'lucide-react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Button } from '@/components/ui/button';
import { SystemOverlay } from './SystemOverlay';
import { useDocumentPip } from './useDocumentPip';
import type { MapViewData } from '@/types';

/**
 * Toolbar control that pops the read-only `SystemOverlay` into an always-on-top
 * Document Picture-in-Picture window and portals the overlay into it. Because it
 * sits in the map toolbar (inside `MapPresenceProvider` + `MapActiveCharProvider`)
 * the portalled child resolves `usePresenceForSystem` / `useMapActiveChar`
 * against the same live state. On non-Chromium browsers the button is disabled
 * with an explanatory tooltip.
 */
export function SystemOverlayButton({ viewData }: { viewData: MapViewData }) {
  const { pipWindow, isOpen, isSupported, open, close } = useDocumentPip();

  const tooltip = isSupported
    ? 'Open a floating read-only overlay in its own window.'
    : 'The floating system overlay needs the Document Picture-in-Picture API, available only in Chromium-based browsers (Chrome, Edge, …).';

  return (
    <>
      <Tooltip.Root>
        <Tooltip.Trigger render={<span className="inline-flex" />}>
          <Button
            variant={isOpen ? 'secondary' : 'ghost'}
            size="sm"
            disabled={!isSupported}
            aria-pressed={isSupported ? isOpen : undefined}
            onClick={() => {
              if (!isSupported) return;
              if (isOpen) close();
              else void open();
            }}
          >
            <PictureInPicture2 />
            Overlay
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={4} side="bottom" align="center">
            <Tooltip.Popup className="z-50 max-w-[18rem] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
              {tooltip}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      {pipWindow && createPortal(<SystemOverlay viewData={viewData} />, pipWindow.document.body)}
    </>
  );
}
