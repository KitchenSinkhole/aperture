'use client';

import { Navigation } from 'lucide-react';
import { toast } from 'sonner';

import type { MapSystemNode } from '@/types';
import { addRouteDestinationAction } from '@/app/(app)/actions/routes';
import { publishRouteDestination } from '@/lib/map/routeDestinationBus';
import { isExperimentalUiActive, readExperimentalUiFromHtml } from '@/lib/experimentalUi';
import { MenuItem } from '@/components/ui/menu';

const systemLabel = (s: MapSystemNode) => s.alias?.trim() || s.name;

/**
 * Experimental "Route here" — saves the system as a route destination and opens
 * the planner list (same persistence as "Add to routes").
 */
export function RouteHereItem({
  system,
  onClose,
}: {
  system: MapSystemNode;
  onClose: () => void;
}) {
  if (!isExperimentalUiActive(readExperimentalUiFromHtml())) return null;

  return (
    <MenuItem
      icon={<Navigation className="size-3.5" />}
      onClick={() => {
        void addRouteDestinationAction({ systemId: system.systemId }).then((result) => {
          if (result.ok) {
            publishRouteDestination(result.data);
            toast.success(`Routing to ${systemLabel(system)}`);
          } else {
            toast.error(result.error);
          }
        });
        onClose();
      }}
    >
      Route here
    </MenuItem>
  );
}
