-- Managing public share links (`/live/<token>`) becomes a delegatable map
-- feature, and minting / revoking one lands in the map audit log.
--
-- `share_manage` is appended last so the existing `map_capability` ordinals are
-- untouched; no code compares the enum ordinally. The two `ap_event_kind` rows
-- sit in the `access` category alongside the per-title delegation kinds --
-- publishing a chain to an anonymous audience is an access change.
-- `ap_map_event.kind` is not FK-constrained to this catalog, so the inserts
-- work without these rows; they exist so the admin history filter lists them.
--
-- The seed does not reference the new enum label, so it is safe in the same
-- transaction as the `ADD VALUE`.
--
-- Rollback: src/db/migrations/0061_map_share_management.rollback.sql.

ALTER TYPE "public"."map_capability" ADD VALUE IF NOT EXISTS 'share_manage';--> statement-breakpoint
INSERT INTO "ap_event_kind" ("kind", "category") VALUES
  ('share.created', 'access'),
  ('share.revoked', 'access')
ON CONFLICT ("kind") DO NOTHING;
