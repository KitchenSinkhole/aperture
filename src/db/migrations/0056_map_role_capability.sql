-- Per-title map feature delegation — `ap_map_role_access.capability`.
--
-- The per-map role grant gains a capability axis so a director can hand a
-- single director-gated feature (audit log, settings, webhooks, import,
-- export, delete) to a specific EVE corporation title without making its
-- holders full Directors. A grant is one `(map_id, role_id, capability)` row.
--
-- `view` is the existing role→map view overlay: any grant for a role the
-- viewer holds implies visibility (the read paths match on `role_id` with no
-- capability filter), so a feature grant on a map the title cannot otherwise
-- see still lets it see the map. Existing rows backfill to `view` via the
-- column default, which is then dropped so future inserts must name a
-- capability explicitly.
--
-- Capabilities are additive across the titles a character holds — there are no
-- deny-grants; the union wins. Directors/owners/admins hold every capability
-- implicitly and never need a row.
--
-- Rollback: src/db/migrations/0056_map_role_capability.rollback.sql.

CREATE TYPE "public"."map_capability" AS ENUM('view', 'audit_view', 'settings_manage', 'webhooks_manage', 'map_import', 'map_export', 'map_delete');--> statement-breakpoint

ALTER TABLE "ap_map_role_access" ADD COLUMN "capability" "map_capability" NOT NULL DEFAULT 'view';--> statement-breakpoint
ALTER TABLE "ap_map_role_access" DROP CONSTRAINT "ap_map_role_access_pk";--> statement-breakpoint
ALTER TABLE "ap_map_role_access" ADD CONSTRAINT "ap_map_role_access_pk" PRIMARY KEY ("map_id", "role_id", "capability");--> statement-breakpoint
ALTER TABLE "ap_map_role_access" ALTER COLUMN "capability" DROP DEFAULT;
