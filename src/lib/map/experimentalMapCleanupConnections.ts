import type { MapConnectionEdge } from '@/types';

/** Experimental map cleanup target: wormhole connections already marked expired on the chart. */
export function connectionsForExperimentalMapCleanup(
  connections: MapConnectionEdge[],
): MapConnectionEdge[] {
  return connections.filter((c) => c.eolStage === 'expired');
}