CREATE TYPE "public"."eol_source" AS ENUM('auto', 'observed');--> statement-breakpoint
ALTER TABLE "ap_map" ADD COLUMN "auto_eol_connections" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_map_connection" ADD COLUMN "eol_source" "eol_source";--> statement-breakpoint
-- Every stage set before this migration was set by a human: there was no
-- automatic EOL writer. Must precede the check constraint, which rejects a set
-- stage with no provenance.
UPDATE "ap_map_connection" SET "eol_source" = 'observed' WHERE "eol_stage" <> 'none';--> statement-breakpoint
ALTER TABLE "ap_map_connection" ADD CONSTRAINT "ap_map_connection_eol_source_chk" CHECK (("ap_map_connection"."eol_stage" = 'none' AND "ap_map_connection"."eol_source" IS DISTINCT FROM 'auto') OR ("ap_map_connection"."eol_stage" <> 'none' AND "ap_map_connection"."eol_source" IS NOT NULL));
