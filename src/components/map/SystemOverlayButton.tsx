'use client';

import { createPortal } from 'react-dom';
import { PictureInPicture2 } from 'lucide-react';
import { Tooltip } from '@base-ui/react/tooltip';
import { Button } from '@/components/ui/button';
import { SystemOverlay } from './SystemOverlay';
import { useDocumentPip } from './useDocumentPip';
import type { MapViewData, OverlayFitOverflow } from '@/types';

/**
 * Toolbar control that pops the read-only `SystemOverlay` into an always-on-top
 * Document Picture-in-Picture window and portals the overlay into it. Because it
 * sits in the map toolbar (inside `MapPresenceProvider` + `MapActiveCharProvider`)
 * the portalled child resolves `usePresenceForSystem` / `useMapActiveChar`
 * against the same live state. On non-Chromium browsers the button is disabled
 * with an explanatory tooltip.
 */
export function SystemOverlayButton({
  viewData,
  overlayFitOverflow,
}: {
  viewData: MapViewData;
  /** Instance-wide policy for the overlay's fit-columns-to-content action. */
  overlayFitOverflow: OverlayFitOverflow;
}) {
  const { pipWindow, isOpen, isSupported, open, close } = useDocumentPip();

  if (!isSupported) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger render={<span className="inline-flex" />}>
          <Button variant="ghost" size="sm" disabled>
            <PictureInPicture2 />
            Overlay
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={4} side="bottom" align="center">
            <Tooltip.Popup className="z-50 max-w-[18rem] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
              The floating system overlay needs the Document Picture-in-Picture API, available only
              in Chromium-based browsers (Chrome, Edge, …).
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  return (
    <>
      <Button
        variant={isOpen ? 'secondary' : 'ghost'}
        size="sm"
        aria-pressed={isOpen}
        onClick={() => {
          if (isOpen) close();
          else void open();
        }}
      >
        <PictureInPicture2 />
        Overlay
      </Button>
      {pipWindow &&
        createPortal(
          <SystemOverlay viewData={viewData} fitOverflow={overlayFitOverflow} />,
          pipWindow.document.body,
        )}
    </>
  );
}
