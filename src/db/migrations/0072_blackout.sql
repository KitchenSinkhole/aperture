-- Blackout: an instance-wide switch that hides tracked pilots' presence from
-- everyone but their own account and a cleared list.
--
-- `ap_instance.blackout_since` (NULL = off) and `blackout_by_character_id` hold
-- the switch. The cleared list is instance-scoped `ap_access_grant` rows with
-- the new `blackout_view` capability, limited to `character` / `role`
-- principals.
--
-- Both CHECKs compare `capability::text`, so the new label is never parsed as
-- an enum literal in the transaction that adds it (the migrator applies every
-- pending migration in one transaction).
--
-- Rollback: src/db/migrations/0072_blackout.rollback.sql.

ALTER TYPE "public"."access_capability" ADD VALUE IF NOT EXISTS 'blackout_view';--> statement-breakpoint
ALTER TABLE "ap_access_grant" DROP CONSTRAINT "ap_access_grant_capability_scope_chk";--> statement-breakpoint
ALTER TABLE "ap_instance" ADD COLUMN "blackout_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ap_instance" ADD COLUMN "blackout_by_character_id" bigint;--> statement-breakpoint
ALTER TABLE "ap_instance" ADD CONSTRAINT "ap_instance_blackout_by_character_id_ap_character_id_fk" FOREIGN KEY ("blackout_by_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_access_grant" ADD CONSTRAINT "ap_access_grant_blackout_principal_chk" CHECK ("ap_access_grant"."capability"::text <> 'blackout_view' or "ap_access_grant"."principal_kind" in ('character', 'role'));--> statement-breakpoint
ALTER TABLE "ap_access_grant" ADD CONSTRAINT "ap_access_grant_capability_scope_chk" CHECK (("ap_access_grant"."scope" = 'instance' and "ap_access_grant"."capability"::text in ('login', 'admin', 'blackout_view'))
          or ("ap_access_grant"."scope" = 'map' and "ap_access_grant"."capability"::text in ('view', 'edit')));