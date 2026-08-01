-- Manual rollback for 0059_character_presence.sql.
--   psql "$DATABASE_URL" -f src/db/migrations/0059_character_presence.rollback.sql
DROP TABLE IF EXISTS "ap_character_presence";
