## index.ts

**Purpose:** Schema barrel — re-exports every `universe_*` table and the effective-dogma view for the Drizzle client and migration tooling.
**File:** `src/db/schema/index.ts`

Re-exports `universe/{geography,items,dogma,statics,views,sovereignty}`, `ap/{enums,instance,access_grant,user,character}`, the map schema `ap/{map,map_system,map_note,map_connection,map_signature,map_event,event_kind}`, and `ap/{system_stats,job_run,map_character_tracking,map_tracking_seed,webhook,corporation,alliance,role,structure}`. Imported as `* as schema` by `src/db/client.ts` and globbed by `drizzle.config.ts`.
