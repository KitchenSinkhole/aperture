'use client';

import { useStore } from '@xyflow/react';

// Edge-layer marks live in flow coordinates, so the viewport transform shrinks
// them along with everything else. A node tile survives that — a 7px circle
// does not. This compensates a mark's dimensions against the current zoom so it
// holds a legible size on screen at any zoom level.

/** Floor: zooming in past 1 leaves the mark essentially fixed to the geometry rather than shrinking it. */
const MIN_SCALE = 0.9;
/** Ceiling: the reciprocal of the canvas's minimum zoom, so a mark holds its design size all the way out. */
const MAX_SCALE = 2;

/**
 * Multiplier for a flow-space mark dimension (radius, standoff, stroke width)
 * that keeps it near its design size on screen across the zoom range.
 * Subscribes to the xyflow viewport, so a consumer re-renders on zoom.
 */
export function useMarkScale(): number {
  return useStore((s) => Math.min(Math.max(1 / s.transform[2], MIN_SCALE), MAX_SCALE));
}
