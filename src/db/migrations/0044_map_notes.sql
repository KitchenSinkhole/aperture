-- Map notes (GitHub issue #5) — a free-standing, movable/lockable note object on
-- the map, replacing the "rename an inaccessible Jovian system" hack for
-- broadcasting map-wide intel to pilots.
--
-- Notes ride the existing `ap_map_event` → `tg_map_event_notify` → `mapUpdate`
-- realtime path; no new trigger. Attribution (creator + last editor) is
-- denormalized onto the row via two `ON DELETE SET NULL` FKs so the inspector
-- can show who created/last-edited a note without a jsonb-id audit scan.
-- Hard-deleted (no natural re-add key) — no `visible` soft-delete column.
--
-- `ap_map_event.kind` has no FK to `ap_event_kind`, so the three seed rows are
-- documentation-grade (history-filter catalog), mirroring how 0004 seeded the
-- original kinds.
--
-- Rollback: src/db/migrations/0044_map_notes.rollback.sql.

CREATE TYPE "public"."map_note_severity" AS ENUM('neutral', 'green', 'yellow', 'red');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ap_map_note" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"map_id" bigint NOT NULL,
	"position_x" double precision DEFAULT 0 NOT NULL,
	"position_y" double precision DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"severity" "map_note_severity" DEFAULT 'neutral' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_by_character_id" bigint,
	"last_edited_by_character_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_map_note_map_id_ap_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."ap_map"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "ap_map_note_created_by_character_id_ap_character_id_fk" FOREIGN KEY ("created_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "ap_map_note_last_edited_by_character_id_ap_character_id_fk" FOREIGN KEY ("last_edited_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ap_map_note_map_id_idx" ON "ap_map_note" USING btree ("map_id");--> statement-breakpoint
INSERT INTO "ap_event_kind" ("kind", "category") VALUES
	('note.created', 'note'),
	('note.updated', 'note'),
	('note.deleted', 'note');
