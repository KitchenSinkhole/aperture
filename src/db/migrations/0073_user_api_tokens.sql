-- Per-map user API tokens (issue #293): read-only bearer tokens a map viewer
-- mints for their own tools, behind a per-map switch and scope list.
--
-- `ap_map_api_token` stores only the sha256 hex digest of each token. It is
-- owned by an account (`ap_user`), not a character, and goes with it.
-- `ap_map.api_enabled` / `api_scopes` are the map's switch and exposed scopes;
-- `ap_user.api_blocked_*` is the account-wide abuse block; and
-- `ap_instance.user_api_enabled` is the operator kill switch.
--
-- `api_manage` is appended last to `map_capability`; no code compares the enum
-- ordinally, and nothing below references the new label, so the `ADD VALUE` is
-- safe in the migrator's single transaction. The six `ap_event_kind` rows sit
-- in the `access` category with the share-link kinds; `ap_map_event.kind` is
-- not FK-constrained to the catalog, so they exist for the admin history filter.
--
-- Rollback: src/db/migrations/0073_user_api_tokens.rollback.sql.

CREATE TYPE "public"."api_scope" AS ENUM('map', 'signatures', 'pilots', 'notes', 'mass_log', 'kills');--> statement-breakpoint
CREATE TYPE "public"."api_token_revoke_reason" AS ENUM('creator', 'manager', 'abuse', 'admin');--> statement-breakpoint
ALTER TYPE "public"."map_capability" ADD VALUE IF NOT EXISTS 'api_manage';--> statement-breakpoint
CREATE TABLE "ap_map_api_token" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"map_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"label" text NOT NULL,
	"scopes" "api_scope"[] NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"suspended_until" timestamp with time zone,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"last_strike_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "api_token_revoke_reason",
	"revoked_by_character_id" bigint,
	CONSTRAINT "ap_map_api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "ap_instance" ADD COLUMN "user_api_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_user" ADD COLUMN "api_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ap_user" ADD COLUMN "api_blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ap_user" ADD COLUMN "api_block_reason" text;--> statement-breakpoint
ALTER TABLE "ap_map" ADD COLUMN "api_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_map" ADD COLUMN "api_scopes" "api_scope"[] DEFAULT '{}'::api_scope[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_map_api_token" ADD CONSTRAINT "ap_map_api_token_map_id_ap_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."ap_map"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_api_token" ADD CONSTRAINT "ap_map_api_token_user_id_ap_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ap_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_api_token" ADD CONSTRAINT "ap_map_api_token_revoked_by_character_id_ap_character_id_fk" FOREIGN KEY ("revoked_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_map_api_token_map_id_idx" ON "ap_map_api_token" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "ap_map_api_token_user_id_idx" ON "ap_map_api_token" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "ap_event_kind" ("kind", "category") VALUES
  ('api.enabled', 'access'),
  ('api.disabled', 'access'),
  ('api.scopes_changed', 'access'),
  ('api.token_created', 'access'),
  ('api.token_revoked', 'access'),
  ('api.token_suspended', 'access')
ON CONFLICT ("kind") DO NOTHING;
