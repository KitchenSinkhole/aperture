-- Rollback for 0048_signature_activity_override.sql.
--
-- Drops the `activity_override` column and the `signature_activity` enum. Any
-- stored manual site-safety overrides are discarded (the derived value covers
-- every row afterwards).

ALTER TABLE "ap_map_signature" DROP COLUMN "activity_override";--> statement-breakpoint
DROP TYPE "public"."signature_activity";
