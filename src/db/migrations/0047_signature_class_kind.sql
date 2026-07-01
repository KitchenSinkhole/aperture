-- Signature class kind — Cosmic Signature vs Cosmic Anomaly.
--
-- EVE's probe-scanner paste carries a "Class" column distinguishing entries
-- that must be scanned down (Cosmic Signature) from instantly-warpable ones
-- (Cosmic Anomaly).
--
-- Nullable: paste-derived only, so pre-existing rows and low-information
-- manual rows have no known kind (cannot be backfilled — the source paste is
-- gone).
--
-- Rollback: src/db/migrations/0047_signature_class_kind.rollback.sql.

CREATE TYPE "public"."signature_class_kind" AS ENUM('signature', 'anomaly');--> statement-breakpoint

ALTER TABLE "ap_map_signature" ADD COLUMN "class_kind" "signature_class_kind";