-- Manual rollback for 0070_intel_scope.sql. Drops the intel-tenancy columns from
-- `ap_structure` / `ap_structure_event` and then the enum they use. Run by hand
-- (drizzle-kit is forward-only):
--   psql "$DATABASE_URL" -f src/db/migrations/0070_intel_scope.rollback.sql
--
-- Backfilled scope values are not recoverable; re-running the forward migration
-- re-derives them from `ap_instance_owner`.
ALTER TABLE "ap_structure_event" DROP CONSTRAINT IF EXISTS "ap_structure_event_scope_matches_owner_chk";
ALTER TABLE "ap_structure" DROP CONSTRAINT IF EXISTS "ap_structure_scope_matches_owner_chk";
DROP INDEX IF EXISTS "ap_structure_event_scope_idx";
DROP INDEX IF EXISTS "ap_structure_scope_idx";
ALTER TABLE "ap_structure_event" DROP CONSTRAINT IF EXISTS "ap_structure_event_scope_character_id_ap_character_id_fk";
ALTER TABLE "ap_structure" DROP CONSTRAINT IF EXISTS "ap_structure_scope_character_id_ap_character_id_fk";
ALTER TABLE "ap_structure_event" DROP COLUMN IF EXISTS "scope_alliance_id";
ALTER TABLE "ap_structure_event" DROP COLUMN IF EXISTS "scope_corporation_id";
ALTER TABLE "ap_structure_event" DROP COLUMN IF EXISTS "scope_character_id";
ALTER TABLE "ap_structure_event" DROP COLUMN IF EXISTS "scope";
ALTER TABLE "ap_structure" DROP COLUMN IF EXISTS "scope_alliance_id";
ALTER TABLE "ap_structure" DROP COLUMN IF EXISTS "scope_corporation_id";
ALTER TABLE "ap_structure" DROP COLUMN IF EXISTS "scope_character_id";
ALTER TABLE "ap_structure" DROP COLUMN IF EXISTS "scope";
DROP TYPE IF EXISTS "public"."intel_scope";
