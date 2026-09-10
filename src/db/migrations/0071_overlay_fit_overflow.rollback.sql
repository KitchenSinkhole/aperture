-- Manual rollback for 0071_overlay_fit_overflow.sql. Drops the overlay
-- fit-overflow policy column from `ap_instance` and then the enum it uses. Run
-- by hand (drizzle-kit is forward-only):
--   psql "$DATABASE_URL" -f src/db/migrations/0071_overlay_fit_overflow.rollback.sql
--
-- The chosen policy is lost; re-running the forward migration restores the
-- `proportional` default.
ALTER TABLE "ap_instance" DROP COLUMN IF EXISTS "overlay_fit_overflow";
DROP TYPE IF EXISTS "public"."overlay_fit_overflow";
