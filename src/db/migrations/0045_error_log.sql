CREATE TYPE "public"."error_level" AS ENUM('warn', 'error', 'fatal');
--> statement-breakpoint
CREATE TYPE "public"."error_source" AS ENUM('server', 'job', 'client');
--> statement-breakpoint
CREATE TABLE "ap_error_log" (
	"id" bigserial,
	"occurred_at" timestamp with time zone NOT NULL,
	"level" "error_level" NOT NULL,
	"source" "error_source" NOT NULL,
	"message" text NOT NULL,
	"character_id" bigint,
	"context" jsonb,
	CONSTRAINT "ap_error_log_id_occurred_at_pk" PRIMARY KEY("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
-- Daily partitions managed by pg_partman (installed into the `partman` schema by
-- docker/postgres/initdb/01-extensions.sql), mirroring ap_system_stats. Rolloff
-- is DETACH/DROP PARTITION, not DELETE.
SELECT partman.create_parent(
	p_parent_table := 'public.ap_error_log',
	p_control := 'occurred_at',
	p_interval := '1 day'
);
--> statement-breakpoint
-- 30-day retention enforced by the existing partition-maintenance job
-- (partman.run_maintenance); no dedicated reap task.
UPDATE "partman"."part_config"
	SET "retention" = '30 days',
		"retention_keep_table" = false,
		"retention_keep_index" = false
	WHERE "parent_table" = 'public.ap_error_log';
--> statement-breakpoint
ALTER TABLE "ap_error_log" ADD CONSTRAINT "ap_error_log_character_id_ap_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;
