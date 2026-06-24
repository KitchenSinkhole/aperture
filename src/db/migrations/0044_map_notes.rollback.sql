-- Manual rollback for 0044_map_notes.sql. Drops the map-notes table, its event
-- kinds, and the severity enum in reverse order.
--   psql "$DATABASE_URL" -f src/db/migrations/0044_map_notes.rollback.sql
DELETE FROM "ap_event_kind" WHERE "kind" IN ('note.created', 'note.updated', 'note.deleted');--> statement-breakpoint
DROP TABLE IF EXISTS "ap_map_note";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."map_note_severity";
