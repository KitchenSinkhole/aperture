-- Convert ap_job_run to pg_partman daily partitions with 14-day retention.
-- ap_job_run was 91% of the DB (14.5M rows / 4.1 GB), unpartitioned and growing
-- linearly with tracked characters. Sampling (withInstrumentation) cuts the
-- inflow; this caps retention. The table is a pure observability log with no FKs
-- pointing at it, so a one-time DROP purges the backlog and reclaims the space
-- immediately (a DELETE would bloat first). partman v5 has no clean in-place
-- convert for a populated table; recreate empty-partitioned, mirroring 0046.
DROP TABLE IF EXISTS "ap_job_run";
--> statement-breakpoint
-- Partition key (started_at) must be part of the PK; id stays globally unique via
-- the sequence. weight = how many runs a row represents (sampled success rows
-- carry N; failures and full-fidelity rows carry 1) so sum(weight) un-biases the
-- job-success rate. The full-fidelity finalising UPDATE keys on id alone, which
-- can't partition-prune, but with ~14+premake daily partitions the scan is cheap.
CREATE TABLE "ap_job_run" (
	"id" bigserial,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"success" boolean,
	"error_text" text,
	"notes" jsonb,
	"weight" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ap_job_run_id_started_at_pk" PRIMARY KEY("id","started_at")
) PARTITION BY RANGE ("started_at");
--> statement-breakpoint
CREATE INDEX "ap_job_run_name_started_at_idx" ON "ap_job_run" USING btree ("name","started_at" DESC NULLS LAST);
--> statement-breakpoint
-- Daily partitions managed by pg_partman (installed into the `partman` schema by
-- docker/postgres/initdb/01-extensions.sql). Rolloff is DETACH/DROP PARTITION.
SELECT partman.create_parent(
	p_parent_table := 'public.ap_job_run',
	p_control := 'started_at',
	p_interval := '1 day'
);
--> statement-breakpoint
-- 14-day retention enforced by the existing partition-maintenance job
-- (partman.run_maintenance); no dedicated reap task.
UPDATE "partman"."part_config"
	SET "retention" = '14 days',
		"retention_keep_table" = false,
		"retention_keep_index" = false
	WHERE "parent_table" = 'public.ap_job_run';
