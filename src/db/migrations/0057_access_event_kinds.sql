-- Catalog the per-title delegation audit events in `ap_event_kind`.
--
-- Granting or revoking a delegatable map feature to a corp title lands as one
-- `ap_map_event` (kinds `access.granted` / `access.revoked`). `ap_map_event.kind`
-- is not FK-constrained to this catalog, so the insert works without these rows;
-- they exist so the admin history filter lists the new `access` category.
--
-- Rollback: src/db/migrations/0057_access_event_kinds.rollback.sql.

INSERT INTO "ap_event_kind" ("kind", "category") VALUES
  ('access.granted', 'access'),
  ('access.revoked', 'access')
ON CONFLICT ("kind") DO NOTHING;
