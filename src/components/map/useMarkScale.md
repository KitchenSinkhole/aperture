## useMarkScale.ts

**Purpose:** Zoom-compensation multiplier for small marks drawn in flow coordinates on the edge layer.
**File:** `src/components/map/useMarkScale.ts`

---

### useMarkScale(): number
Returns a multiplier to apply to a flow-space mark dimension (radius, standoff, stroke width) so the mark holds roughly its design size on screen as the canvas zooms. Computed as `1 / zoom` clamped to `[0.9, 1.9]`: below zoom 1 the mark grows toward a constant screen size, capped short of full compensation so a zoomed-out map's marks never swamp the tiles they annotate; above zoom 1 the floor keeps the mark fixed to the geometry instead of shrinking it.

Subscribes to the xyflow store's viewport transform, so any consumer re-renders on zoom. Must be called inside a `ReactFlow` provider.

**Returns:** The multiplier.
