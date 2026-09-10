-- Manual rollback for 0073_route_settings_keep_open.sql. Drops the route-planner
-- popover dismiss columns from `ap_instance` and `ap_user`. Run by hand
-- (drizzle-kit is forward-only):
--   psql "$DATABASE_URL" -f src/db/migrations/0073_route_settings_keep_open.rollback.sql
--
-- Every per-account override is lost; re-running the forward migration restores
-- the close-on-outside-press default for the whole deployment.
ALTER TABLE "ap_user" DROP COLUMN IF EXISTS "route_settings_keep_open";
ALTER TABLE "ap_instance" DROP COLUMN IF EXISTS "route_settings_keep_open";
