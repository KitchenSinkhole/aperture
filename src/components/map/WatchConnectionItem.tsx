'use client';

import { MenuCheckboxItem } from '@/components/ui/menu';
import { toggleConnectionWatch, useIsConnectionWatched } from '@/lib/connectionWatchPrefs';
import type { ConnectionScope } from '@/lib/map/enumLabels';

/**
 * "Watch this wormhole" context-menu checkbox. Self-contained like
 * `SetDestinationItem`: it reads and writes the device-local watch store
 * directly rather than routing through a `MapCanvas` callback, since a watch
 * never reaches the server.
 *
 * Only a wormhole can be watched, but an already-watched connection keeps the
 * item whatever its scope, so a hole reclassified as a gate can still be
 * unwatched rather than chiming with no way to stop it.
 */
export function WatchConnectionItem({
  mapId,
  connectionId,
  scope,
  onClose,
}: {
  mapId: string;
  connectionId: string;
  scope: ConnectionScope;
  onClose: () => void;
}) {
  const watched = useIsConnectionWatched(mapId, connectionId);
  if (scope !== 'wh' && !watched) return null;
  return (
    <MenuCheckboxItem
      checked={watched}
      onCheckedChange={() => {
        toggleConnectionWatch(mapId, connectionId);
        onClose();
      }}
    >
      Watch this wormhole
    </MenuCheckboxItem>
  );
}
