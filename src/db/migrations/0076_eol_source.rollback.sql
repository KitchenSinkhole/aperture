-- Rollback of 0076_eol_source.sql. Drops the EOL provenance (every connection
-- loses its auto/observed tag; `eol_stage` itself is untouched) and the per-map
-- auto-EOL opt-in.

ALTER TABLE "ap_map_connection" DROP CONSTRAINT "ap_map_connection_eol_source_chk";--> statement-breakpoint
ALTER TABLE "ap_map_connection" DROP COLUMN "eol_source";--> statement-breakpoint
ALTER TABLE "ap_map" DROP COLUMN "auto_eol_connections";--> statement-breakpoint
DROP TYPE "public"."eol_source";
