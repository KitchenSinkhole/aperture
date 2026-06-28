CREATE TABLE "ap_metric_snapshot" (
	"id" bigserial,
	"captured_at" timestamp with time zone NOT NULL,
	"esi_requests_total" bigint NOT NULL,
	"esi_requests_failed" bigint NOT NULL,
	"esi_duration_sum_ms" double precision NOT NULL,
	"esi_duration_count" bigint NOT NULL,
	"route_plan_duration_sum_ms" double precision NOT NULL,
	"route_plan_duration_count" bigint NOT NULL,
	"tracked_characters" integer NOT NULL,
	"visible_systems" integer NOT NULL,
	"ws_connections" integer NOT NULL,
	"esi_breakers_open" integer NOT NULL,
	"job_backlog" integer NOT NULL,
	"jobs_abandoned" integer NOT NULL,
	"process_rss_bytes" bigint NOT NULL,
	"process_heap_used_bytes" bigint NOT NULL,
	"event_loop_lag_ms" double precision NOT NULL,
	CONSTRAINT "ap_metric_snapshot_id_captured_at_pk" PRIMARY KEY("id","captured_at")
) PARTITION BY RANGE ("captured_at");
--> statement-breakpoint
-- Daily partitions managed by pg_partman (installed into the `partman` schema by
-- docker/postgres/initdb/01-extensions.sql), mirroring ap_error_log. Rolloff
-- is DETACH/DROP PARTITION, not DELETE.
SELECT partman.create_parent(
	p_parent_table := 'public.ap_metric_snapshot',
	p_control := 'captured_at',
	p_interval := '1 day'
);
--> statement-breakpoint
-- 30-day retention enforced by the existing partition-maintenance job
-- (partman.run_maintenance); no dedicated reap task.
UPDATE "partman"."part_config"
	SET "retention" = '30 days',
		"retention_keep_table" = false,
		"retention_keep_index" = false
	WHERE "parent_table" = 'public.ap_metric_snapshot';
