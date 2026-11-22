-- `universe_killmail` gains what the user API's `kills` scope reads (issue #293):
-- `solar_system_id`, a stored generated column over the ESI body, indexed with
-- `killmail_time` for the per-system, newest-first read; and `total_value`,
-- zKillboard's ISK estimate, which is not part of the ESI body. Adding a stored
-- generated column rewrites the table once; it is retention-bounded and small.
--
-- Rollback: src/db/migrations/0074_killmail_system_value.rollback.sql.

ALTER TABLE "universe_killmail" ADD COLUMN "solar_system_id" integer GENERATED ALWAYS AS (((body ->> 'solar_system_id'))::integer) STORED;--> statement-breakpoint
ALTER TABLE "universe_killmail" ADD COLUMN "total_value" double precision;--> statement-breakpoint
CREATE INDEX "universe_killmail_system_time_idx" ON "universe_killmail" USING btree ("solar_system_id","killmail_time" DESC NULLS LAST);