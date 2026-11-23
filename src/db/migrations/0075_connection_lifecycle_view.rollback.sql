-- Rollback of 0075_connection_lifecycle_view.sql. Drops the view; the
-- `ap_map_event` rows it reads are untouched.

DROP VIEW IF EXISTS "ap_connection_lifecycle";
