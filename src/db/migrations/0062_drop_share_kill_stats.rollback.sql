-- Rollback of 0062_drop_share_kill_stats.sql. Restores the column at the
-- default it was created with; the per-token values it held are not recoverable.

ALTER TABLE "ap_map_share" ADD COLUMN "show_kill_stats" boolean DEFAULT true NOT NULL;
