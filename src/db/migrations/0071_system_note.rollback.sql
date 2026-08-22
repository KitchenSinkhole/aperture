-- Manual rollback for 0071_system_note.sql. Drops the global system-notes
-- tables, their accountability log, and the instance vocabulary column.
--   psql "$DATABASE_URL" -f src/db/migrations/0071_system_note.rollback.sql
DROP TABLE IF EXISTS "ap_system_note_event";
--> statement-breakpoint
DROP TABLE IF EXISTS "ap_system_note";
--> statement-breakpoint
DROP TYPE IF EXISTS "system_note_event_kind";
--> statement-breakpoint
ALTER TABLE "ap_instance" DROP COLUMN IF EXISTS "system_note_categories";
