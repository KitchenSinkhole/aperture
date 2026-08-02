-- Manual rollback for 0060_map_share.sql.
--   psql "$DATABASE_URL" -f src/db/migrations/0060_map_share.rollback.sql
DROP TABLE IF EXISTS "ap_map_share";
DROP TYPE IF EXISTS "public"."share_presence_mode";
