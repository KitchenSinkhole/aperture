## useMarkScale.ts

**Purpose:** Zoom-compensation multiplier for small marks drawn in flow coordinates on the edge layer.
**File:** `src/components/map/useMarkScale.ts`

---

### useMarkScale(): number
Returns a multiplier to apply to a flow-space mark dimension (radius, standoff, stroke width) so the mark holds roughly its design size on screen as the canvas zooms. Computed as `1 / zoom` and clamped at both ends: the ceiling is the reciprocal of the app canvas's minimum zoom, so a mark holds its design size across that canvas's full zoom-out range; the floor sits just below 1, so zooming past 1 leaves the mark fixed to the geometry rather than shrinking it.

Subscribes to the xyflow store's viewport transform, so any consumer re-renders on zoom. Must be called inside a `ReactFlow` provider.

**Returns:** The multiplier.
