-- Rollback of 0072_blackout.sql.
--
-- Lifts any Blackout in force (the columns go) and drops the cleared list:
-- every `blackout_view` grant is deleted before `access_capability` is
-- recreated without the label.

ALTER TABLE "ap_instance" DROP CONSTRAINT "ap_instance_blackout_by_character_id_ap_character_id_fk";--> statement-breakpoint
ALTER TABLE "ap_instance" DROP COLUMN "blackout_by_character_id";--> statement-breakpoint
ALTER TABLE "ap_instance" DROP COLUMN "blackout_since";--> statement-breakpoint
DELETE FROM "ap_access_grant" WHERE "capability"::text = 'blackout_view';--> statement-breakpoint
ALTER TABLE "ap_access_grant" DROP CONSTRAINT "ap_access_grant_blackout_principal_chk";--> statement-breakpoint
ALTER TABLE "ap_access_grant" DROP CONSTRAINT "ap_access_grant_capability_scope_chk";--> statement-breakpoint
ALTER TYPE "public"."access_capability" RENAME TO "access_capability_old";--> statement-breakpoint
CREATE TYPE "public"."access_capability" AS ENUM('login', 'admin', 'view', 'edit');--> statement-breakpoint
ALTER TABLE "ap_access_grant" ALTER COLUMN "capability" TYPE "public"."access_capability" USING "capability"::text::"public"."access_capability";--> statement-breakpoint
DROP TYPE "public"."access_capability_old";--> statement-breakpoint
ALTER TABLE "ap_access_grant" ADD CONSTRAINT "ap_access_grant_capability_scope_chk" CHECK (("scope" = 'instance' AND "capability" IN ('login', 'admin')) OR ("scope" = 'map' AND "capability" IN ('view', 'edit')));
