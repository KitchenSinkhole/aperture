-- Rollback of 0074_killmail_system_value.sql. Drops the system index and both
-- columns; cached bodies are untouched.

DROP INDEX IF EXISTS "universe_killmail_system_time_idx";--> statement-breakpoint
ALTER TABLE "universe_killmail" DROP COLUMN IF EXISTS "total_value";--> statement-breakpoint
ALTER TABLE "universe_killmail" DROP COLUMN IF EXISTS "solar_system_id";
