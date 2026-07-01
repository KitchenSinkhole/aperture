-- Rollback for 0047_signature_class_kind.sql.
--
-- Drops the `class_kind` column and the `signature_class_kind` enum. Any stored
-- signature/anomaly classifications are discarded.

ALTER TABLE "ap_map_signature" DROP COLUMN "class_kind";--> statement-breakpoint
DROP TYPE "public"."signature_class_kind";