-- Rollback of 0057_access_event_kinds.sql.

DELETE FROM "ap_event_kind" WHERE "kind" IN ('access.granted', 'access.revoked');
