-- Manual rollback for 0056_map_role_capability.sql.
--   psql "$DATABASE_URL" -f src/db/migrations/0056_map_role_capability.rollback.sql
ALTER TABLE "ap_map_role_access" DROP CONSTRAINT IF EXISTS "ap_map_role_access_pk";--> statement-breakpoint
ALTER TABLE "ap_map_role_access" DROP COLUMN IF EXISTS "capability";--> statement-breakpoint
ALTER TABLE "ap_map_role_access" ADD CONSTRAINT "ap_map_role_access_pk" PRIMARY KEY ("map_id", "role_id");--> statement-breakpoint
DROP TYPE IF EXISTS "public"."map_capability";
