## experimentalMapCleanupConnections.ts

**Purpose:** Select connection rows for experimental automatic map cleanup on the live chart.
**File:** `src/lib/map/experimentalMapCleanupConnections.ts`

---

### connectionsForExperimentalMapCleanup(connections: MapConnectionEdge[]): MapConnectionEdge[]
Returns edges whose `eolStage` is `expired` (the manual expired pill), distinct from upstream server jobs gated by `delete_expired_connections` / `delete_eol_connections`.