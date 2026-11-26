'use client';

import { Route } from 'lucide-react';
import { toast } from 'sonner';

import type { MapSystemNode } from '@/types';
import { addRouteDestinationAction } from '@/app/(app)/actions/routes';
import { publishRouteDestination } from '@/lib/map/routeDestinationBus';
import { MenuItem } from '@/components/ui/menu';

const systemLabel = (s: MapSystemNode) => s.alias?.trim() || s.name;

/**
 * "Add to routes" context menu item — saves the system as a route-planner
 * destination for the account, then broadcasts the saved row so a mounted
 * RoutePlannerModule folds it without a reload.
 */
export function AddToRoutesItem({
  system,
  onClose,
}: {
  system: MapSystemNode;
  onClose: () => void;
}) {
  return (
    <MenuItem
      icon={<Route className="size-3.5" />}
      onClick={() => {
        void addRouteDestinationAction({ systemId: system.systemId }).then((result) => {
          if (result.ok) {
            publishRouteDestination(result.data);
            toast.success(`Added ${systemLabel(system)} to routes`);
          } else {
            toast.error(result.error);
          }
        });
        onClose();
      }}
    >
      Add to routes
    </MenuItem>
  );
}
