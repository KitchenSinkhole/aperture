-- Manual rollback for 0048_job_run_partition.sql (ap_job_run). Run by hand
-- (not by drizzle-kit, which is forward-only):
--   psql "$DATABASE_URL" -f src/db/migrations/0048_job_run_partition.rollback.sql
-- Detach pg_partman config first so it stops managing the (about-to-be-dropped)
-- table; CASCADE removes the child partitions along with the parent. This does
-- NOT restore prior data — ap_job_run is a purged observability log; the
-- unpartitioned table comes back empty.
DELETE FROM partman.part_config WHERE parent_table = 'public.ap_job_run';
--> statement-breakpoint
DROP TABLE IF EXISTS "ap_job_run" CASCADE;
--> statement-breakpoint
CREATE TABLE "ap_job_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"success" boolean,
	"error_text" text,
	"notes" jsonb
);
--> statement-breakpoint
CREATE INDEX "ap_job_run_name_started_at_idx" ON "ap_job_run" USING btree ("name","started_at" DESC NULLS LAST);
