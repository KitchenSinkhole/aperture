'use client';

import { useState, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import type { WormholeJumpInfoRow } from '@/types';
import { fetchWormholeJumpInfo } from '@/lib/reference/client';
import { jumpMassBand } from '@/lib/map/wormholeCatalog';
import { WormholeReferenceRows } from './WormholeDetailRows';

// Hover popover anchored to a system node's static label. Surfaces the static
// wormhole's routing data (code / size / leads-to class / masses / lifetime)
// resolved from the session-cached reference catalog, keyed on the static's
// `universe_wormhole.type_id`. Unlike the connection variant there is no realised
// connection, so no mass-logged or EOL rows.
export function StaticDetailPopover({
  typeId,
  children,
}: {
  typeId: number;
  children: ReactNode;
}) {
  const [reference, setReference] = useState<WormholeJumpInfoRow | null>(null);

  const load = () => {
    if (reference?.typeId === typeId) return;
    void fetchWormholeJumpInfo().then((result) => {
      if (result.ok) setReference(result.data.find((r) => r.typeId === typeId) ?? null);
    });
  };

  return (
    <Tooltip.Root onOpenChange={(open) => open && load()}>
      <Tooltip.Trigger render={<span />} className="nodrag nopan cursor-help">
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} side="top" align="center">
          <Tooltip.Popup className="nodrag nopan z-50 flex min-w-[190px] flex-col gap-1 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md">
            <WormholeReferenceRows
              code={reference?.code ?? null}
              sizeClass={jumpMassBand(reference?.jumpMass ?? null)}
              reference={reference}
            />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
