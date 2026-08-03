-- Drop `ap_map_share.show_kill_stats`.
--
-- Kill stats are not part of the public spectator view and will not be: the
-- flag gated nothing, and a redaction toggle a manager can set but that changes
-- nothing published is worse than no toggle at all.
--
-- Rollback: src/db/migrations/0062_drop_share_kill_stats.rollback.sql.

ALTER TABLE "ap_map_share" DROP COLUMN "show_kill_stats";
