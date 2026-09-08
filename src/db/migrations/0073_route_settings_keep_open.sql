-- Whether the route-planner settings popover survives an outside press.
--
-- Two tiers, mirroring `stale_signature_threshold_minutes`: `ap_instance` holds
-- the deployment default (false ⇒ an outside press closes the popover) and
-- `ap_user` holds a personal override. A NULL override inherits the instance
-- default, so an admin changing that default still reaches accounts that have
-- never pinned the popover.
--
-- Rollback: src/db/migrations/0073_route_settings_keep_open.rollback.sql.
ALTER TABLE "ap_instance" ADD COLUMN "route_settings_keep_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_user" ADD COLUMN "route_settings_keep_open" boolean;
