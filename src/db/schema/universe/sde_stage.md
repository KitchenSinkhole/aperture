## sde_stage.ts

**Purpose:** Drizzle table for the ingest's own scratch key set — every row `syncSdeDeletions` needs to check against, without the JS process holding it.
**File:** `src/db/schema/universe/sde_stage.ts`

---

### universeSdeStage
`universe_sde_stage`. **UNLOGGED** (migration 0067) — a crash between the write phase and the sync empties it, so the ingest aborts loudly on the empty-keep gate instead of a surviving half-populated stage driving a mass delete. No PK: the source tables' own PKs already guarantee key uniqueness within a run.

| Column | Type | Notes |
|---|---|---|
| run_id | uuid NOT NULL | Isolates concurrent ingests (job-driven `sde-refresh` vs. an in-process `pnpm sde:bootstrap`, which sits outside `SDE_QUEUE`); a run only ever reads/deletes its own rows |
| table_name | text NOT NULL | The `universe_*` table this row's key belongs to, matching `DeletionSpec.name` |
| id_a | int NOT NULL | Row id, or the first half of a composite key |
| id_b | int | Second half of a composite key (`universe_stargate_edge`, `universe_type_attribute`); null for single-PK tables |

Index `(run_id, table_name, id_a, id_b)`. Populated by the write phase for every table `DELETION_SPECS` covers, read by `syncSdeDeletions`'s per-table `NOT EXISTS` anti-joins, and cleared once the sync for that run completes.
