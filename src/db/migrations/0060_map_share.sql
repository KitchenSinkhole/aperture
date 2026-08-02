-- Table store for issued public map-share links (`/live/<token>`). Each row
-- pins one token to one map with its own redaction profile. `token` is raw
-- text (not hashed) so it can be re-copied from the future management
-- dialog. A share is live when `revoked_at IS NULL AND (expires_at IS NULL
-- OR expires_at > now())` and the parent map is not soft-deleted.
--
-- Rollback: src/db/migrations/0060_map_share.rollback.sql.

CREATE TYPE "public"."share_presence_mode" AS ENUM('none', 'anonymous', 'full');--> statement-breakpoint
CREATE TABLE "ap_map_share" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"map_id" bigint NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"presence_mode" "share_presence_mode" DEFAULT 'anonymous' NOT NULL,
	"show_signatures" boolean DEFAULT false NOT NULL,
	"show_kill_stats" boolean DEFAULT true NOT NULL,
	"show_connection_sig_ids" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_character_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_map_share_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "ap_map_share" ADD CONSTRAINT "ap_map_share_map_id_ap_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."ap_map"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_share" ADD CONSTRAINT "ap_map_share_created_by_character_id_ap_character_id_fk" FOREIGN KEY ("created_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_map_share_map_id_idx" ON "ap_map_share" USING btree ("map_id");