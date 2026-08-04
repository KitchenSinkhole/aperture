CREATE TABLE "ap_sde_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"current_build" integer,
	"current_release_date" date,
	"latest_build" integer,
	"latest_release_date" date,
	"checked_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"retained_orphans" jsonb,
	"uncataloged_wormhole_codes" jsonb,
	CONSTRAINT "ap_sde_state_singleton_chk" CHECK ("ap_sde_state"."id" = 1)
);
