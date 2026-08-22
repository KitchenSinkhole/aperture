CREATE TYPE "public"."system_note_event_kind" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TABLE "ap_system_note" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"system_id" integer NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"locked" boolean DEFAULT false NOT NULL,
	"scope" "intel_scope" NOT NULL,
	"scope_character_id" bigint,
	"scope_corporation_id" bigint,
	"scope_alliance_id" bigint,
	"created_by_character_id" bigint,
	"last_edited_by_character_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_system_note_scope_matches_owner_chk" CHECK (("ap_system_note"."scope" = 'private' and "ap_system_note"."scope_corporation_id" is null and "ap_system_note"."scope_alliance_id" is null)
          or ("ap_system_note"."scope" = 'corp' and "ap_system_note"."scope_character_id" is null and "ap_system_note"."scope_corporation_id" is not null and "ap_system_note"."scope_alliance_id" is null)
          or ("ap_system_note"."scope" = 'alliance' and "ap_system_note"."scope_character_id" is null and "ap_system_note"."scope_corporation_id" is null and "ap_system_note"."scope_alliance_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ap_system_note_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"note_id" bigint NOT NULL,
	"system_id" integer NOT NULL,
	"character_id" bigint,
	"kind" "system_note_event_kind" NOT NULL,
	"payload" jsonb,
	"scope" "intel_scope" NOT NULL,
	"scope_character_id" bigint,
	"scope_corporation_id" bigint,
	"scope_alliance_id" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_system_note_event_scope_matches_owner_chk" CHECK (("ap_system_note_event"."scope" = 'private' and "ap_system_note_event"."scope_corporation_id" is null and "ap_system_note_event"."scope_alliance_id" is null)
          or ("ap_system_note_event"."scope" = 'corp' and "ap_system_note_event"."scope_character_id" is null and "ap_system_note_event"."scope_corporation_id" is not null and "ap_system_note_event"."scope_alliance_id" is null)
          or ("ap_system_note_event"."scope" = 'alliance' and "ap_system_note_event"."scope_character_id" is null and "ap_system_note_event"."scope_corporation_id" is null and "ap_system_note_event"."scope_alliance_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ap_instance" ADD COLUMN "system_note_categories" jsonb;--> statement-breakpoint
ALTER TABLE "ap_system_note" ADD CONSTRAINT "ap_system_note_system_id_universe_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."universe_system"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_system_note" ADD CONSTRAINT "ap_system_note_scope_character_id_ap_character_id_fk" FOREIGN KEY ("scope_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_system_note" ADD CONSTRAINT "ap_system_note_created_by_character_id_ap_character_id_fk" FOREIGN KEY ("created_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_system_note" ADD CONSTRAINT "ap_system_note_last_edited_by_character_id_ap_character_id_fk" FOREIGN KEY ("last_edited_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_system_note_event" ADD CONSTRAINT "ap_system_note_event_character_id_ap_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_system_note_event" ADD CONSTRAINT "ap_system_note_event_scope_character_id_ap_character_id_fk" FOREIGN KEY ("scope_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_system_note_system_id_idx" ON "ap_system_note" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "ap_system_note_scope_idx" ON "ap_system_note" USING btree ("scope","scope_corporation_id","scope_alliance_id","scope_character_id");--> statement-breakpoint
CREATE INDEX "ap_system_note_event_note_id_idx" ON "ap_system_note_event" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "ap_system_note_event_character_id_idx" ON "ap_system_note_event" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "ap_system_note_event_scope_idx" ON "ap_system_note_event" USING btree ("scope","scope_corporation_id","scope_alliance_id","scope_character_id");--> statement-breakpoint
-- The notes browser runs a leading-wildcard ILIKE over every note body; a
-- pg_trgm GIN index keeps that off a full scan as the journal grows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "ap_system_note_body_trgm_idx" ON "ap_system_note" USING gin ("body" gin_trgm_ops);
