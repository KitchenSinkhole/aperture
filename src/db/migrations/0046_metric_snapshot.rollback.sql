-- Manual rollback for 0046_metric_snapshot.sql (ap_metric_snapshot). Run by hand
-- (not by drizzle-kit, which is forward-only) when reverting observability phase 5:
--   psql "$DATABASE_URL" -f src/db/migrations/0046_metric_snapshot.rollback.sql
-- Detach pg_partman config first so it stops managing the (about-to-be-dropped)
-- table; CASCADE removes the child partitions along with the parent.
DELETE FROM partman.part_config WHERE parent_table = 'public.ap_metric_snapshot';
DROP TABLE IF EXISTS "ap_metric_snapshot" CASCADE;
