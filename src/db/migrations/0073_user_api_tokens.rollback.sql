-- Rollback of 0073_user_api_tokens.sql.
--
-- Drops every user API token and the per-map, per-account and instance API
-- columns. `map_capability` is recreated without `api_manage`; any title
-- delegated it loses that grant (managers keep it implicitly, so no map becomes
-- unmanageable). The catalog rows go; already-committed `ap_map_event` rows
-- keep their kind text.

DROP TABLE "ap_map_api_token";--> statement-breakpoint
ALTER TABLE "ap_map" DROP COLUMN "api_scopes";--> statement-breakpoint
ALTER TABLE "ap_map" DROP COLUMN "api_enabled";--> statement-breakpoint
ALTER TABLE "ap_user" DROP COLUMN "api_block_reason";--> statement-breakpoint
ALTER TABLE "ap_user" DROP COLUMN "api_blocked_until";--> statement-breakpoint
ALTER TABLE "ap_user" DROP COLUMN "api_blocked_at";--> statement-breakpoint
ALTER TABLE "ap_instance" DROP COLUMN "user_api_enabled";--> statement-breakpoint
DROP TYPE "public"."api_token_revoke_reason";--> statement-breakpoint
DROP TYPE "public"."api_scope";--> statement-breakpoint
DELETE FROM "ap_map_role_access" WHERE "capability"::text = 'api_manage';--> statement-breakpoint
ALTER TYPE "public"."map_capability" RENAME TO "map_capability_old";--> statement-breakpoint
CREATE TYPE "public"."map_capability" AS ENUM('view', 'audit_view', 'settings_manage', 'webhooks_manage', 'map_import', 'map_export', 'map_delete', 'share_manage');--> statement-breakpoint
ALTER TABLE "ap_map_role_access" ALTER COLUMN "capability" TYPE "public"."map_capability" USING "capability"::text::"public"."map_capability";--> statement-breakpoint
DROP TYPE "public"."map_capability_old";--> statement-breakpoint
DELETE FROM "ap_event_kind" WHERE "kind" IN ('api.enabled', 'api.disabled', 'api.scopes_changed', 'api.token_created', 'api.token_revoked', 'api.token_suspended');
