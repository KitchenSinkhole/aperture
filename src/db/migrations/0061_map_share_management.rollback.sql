-- Rollback of 0061_map_share_management.sql.
--
-- Recreate map_capability without 'share_manage'; any title delegated the
-- capability simply loses that grant (managers keep it implicitly, so no map
-- becomes unmanageable). The audit-kind rows are removed from the catalog;
-- already-committed `ap_map_event` rows keep their kind text.

DELETE FROM "ap_map_role_access" WHERE "capability" = 'share_manage';--> statement-breakpoint
ALTER TYPE "public"."map_capability" RENAME TO "map_capability_old";--> statement-breakpoint
CREATE TYPE "public"."map_capability" AS ENUM('view', 'audit_view', 'settings_manage', 'webhooks_manage', 'map_import', 'map_export', 'map_delete');--> statement-breakpoint
ALTER TABLE "ap_map_role_access" ALTER COLUMN "capability" TYPE "public"."map_capability" USING "capability"::text::"public"."map_capability";--> statement-breakpoint
DROP TYPE "public"."map_capability_old";--> statement-breakpoint
DELETE FROM "ap_event_kind" WHERE "kind" IN ('share.created', 'share.revoked');
