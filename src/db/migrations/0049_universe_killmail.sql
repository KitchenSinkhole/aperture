-- Persistent killmail cache. Killmail bodies are immutable, so the system-killboard
-- feed can fetch each id from ESI once (against the shared app-wide rate-limit
-- bucket) and serve every later open from this table. Age-by-kill-time retention is
-- enforced by the `killmail-cleanup` job, not partman, since the volume is modest.
CREATE TABLE "universe_killmail" (
	"killmail_id" bigint PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"killmail_time" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "universe_killmail_killmail_time_idx" ON "universe_killmail" USING btree ("killmail_time");
