## waypointRequestSchema.ts

**Purpose:** Zod request body for `POST /api/character/waypoint` (single or sequence mode).
**File:** `src/lib/character/waypointRequestSchema.ts`

---

### CHARACTER_WAYPOINT_SEQUENCE_MAX
`number` — cap on `waypointSystemIds` length in sequence mode (currently 10).

### characterWaypointBodySchema
Union of legacy single-destination and multi-waypoint sequence payloads.
