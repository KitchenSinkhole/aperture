-- Signature site-safety override — manual combat/exploration re-mark.
--
-- Site safety (whether running a cosmic site pits you against rats or is an
-- unguarded scan-down) is derived from the site name + scanner group by
-- `siteActivity()`. This column lets a user override that derived value per
-- signature (e.g. mark a gas site as exploration once its rats are cleared).
--
-- Orthogonal to `signature_group_key`: the activity axis (combat vs
-- exploration) is not the scanner group axis — a `relic` site can be a combat
-- activity. Kept as its own type/column so it never reads as a group.
--
-- Nullable: unset means "use the derived value". No backfill — legacy rows stay
-- null and fall through to `siteActivity()`.
--
-- Rollback: src/db/migrations/0048_signature_activity_override.rollback.sql.

CREATE TYPE "public"."signature_activity" AS ENUM('combat', 'exploration');--> statement-breakpoint

ALTER TABLE "ap_map_signature" ADD COLUMN "activity_override" "signature_activity";
