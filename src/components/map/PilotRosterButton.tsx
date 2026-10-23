'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePresenceForMap } from '@/components/map/MapPresenceContext';
import { PilotRoster } from '@/components/map/PilotRoster';
import type { MapSystemNode, MapViewData } from '@/types';

// How often to refresh the "who has the map open" roster while the popover is
// open. Viewer presence is server-side socket state polled over HTTP (no
// realtime push for it), so a modest cadence keeps the icon honest without
// hammering the endpoint. Hard-coded constant, not a runtime knob.
const VIEWERS_POLL_MS = 15_000;

/**
 * Toolbar control that surfaces the online-pilot roster in a non-blocking
 * popover. The roster tracks realtime `characterUpdate` movement (via the
 * presence store) while open, and the popover leaves the map underneath
 * interactive. While open it also polls `/api/map/[id]/viewers` to flag pilots
 * who are online but don't have the map open in Aperture. Must render inside
 * `MapPresenceProvider`.
 */
export function PilotRosterButton({
  viewData,
  pilotsHidden,
}: {
  viewData: MapViewData;
  /** Blackout hides every pilot outside the viewer's account from this viewer. */
  pilotsHidden: boolean;
}) {
  const presence = usePresenceForMap();
  const [open, setOpen] = useState(false);
  const [viewerIds, setViewerIds] = useState<ReadonlySet<number>>(() => new Set());

  // EVE solar-system id → placed map node, for the roster's map-specific tag.
  const systemNameById = useMemo(() => {
    const m = new Map<number, MapSystemNode>();
    for (const s of viewData.systems) m.set(s.systemId, s);
    return m;
  }, [viewData.systems]);

  // Poll the viewer roster only while the popover is open — it's the only time
  // the "online but map not open" icon is on screen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/map/${viewData.map.id}/viewers`, { cache: 'no-store' });
        if (!res.ok) return;
        const body: unknown = await res.json();
        const ids = (body as { characterIds?: unknown }).characterIds;
        if (!cancelled && Array.isArray(ids)) {
          setViewerIds(new Set<number>(ids.filter((x): x is number => typeof x === 'number')));
        }
      } catch {
        // Best-effort: a failed poll just leaves the previous flags in place.
      }
    };
    void load();
    const interval = setInterval(load, VIEWERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, viewData.map.id]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen, details) => {
        // Outside clicks must not dismiss the roster — it stays open until the
        // button is pressed again, so pilots stay visible while working the map.
        if (details.reason === 'outside-press') {
          details.cancel();
          return;
        }
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm">
            <Users />
            Pilots ({presence.length})
          </Button>
        }
      />
      <PopoverContent className="w-[28rem] p-0">
        <PilotRoster
          presence={presence}
          systemNameById={systemNameById}
          viewerIds={viewerIds}
          pilotsHidden={pilotsHidden}
        />
      </PopoverContent>
    </Popover>
  );
}
