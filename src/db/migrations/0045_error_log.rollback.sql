-- Manual rollback for 0045_error_log.sql (ap_error_log). Run by hand (not by
-- drizzle-kit, which is forward-only) when reverting observability phase 4:
--   psql "$DATABASE_URL" -f src/db/migrations/0045_error_log.rollback.sql
-- Detach pg_partman config first so it stops managing the (about-to-be-dropped)
-- table; CASCADE removes the child partitions along with the parent.
DELETE FROM partman.part_config WHERE parent_table = 'public.ap_error_log';
DROP TABLE IF EXISTS "ap_error_log" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."error_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."error_level";
