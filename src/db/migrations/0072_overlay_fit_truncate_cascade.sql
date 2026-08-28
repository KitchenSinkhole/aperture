-- Add 'truncate_cascade' to `overlay_fit_overflow` and make it the default for
-- new instances. Under it the system overlay's fit-columns-to-content action
-- resolves a fit wider than the overlay window by draining the ship-name column
-- to its floor, then the pilot-name column, then the type column — so a long
-- ship name is the first thing to give way and the pilot name the last.
--
-- The type is recreated rather than extended with ALTER TYPE ... ADD VALUE:
-- Postgres refuses to *use* a value added to a pre-existing enum until the
-- adding transaction commits, and drizzle-kit runs every pending migration in a
-- single transaction — so an ADD VALUE could never be followed by the SET
-- DEFAULT, in this migration or any later one. A type created inside the
-- transaction carries no such restriction. Existing rows keep their policy.
--
-- Rollback: src/db/migrations/0072_overlay_fit_truncate_cascade.rollback.sql.

ALTER TABLE "ap_instance" ALTER COLUMN "overlay_fit_overflow" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."overlay_fit_overflow" RENAME TO "overlay_fit_overflow_old";--> statement-breakpoint
CREATE TYPE "public"."overlay_fit_overflow" AS ENUM('proportional', 'grow_window', 'eat_pilot', 'eat_name', 'eat_type', 'truncate_cascade');--> statement-breakpoint
ALTER TABLE "ap_instance" ALTER COLUMN "overlay_fit_overflow" TYPE "public"."overlay_fit_overflow" USING "overlay_fit_overflow"::text::"public"."overlay_fit_overflow";--> statement-breakpoint
ALTER TABLE "ap_instance" ALTER COLUMN "overlay_fit_overflow" SET DEFAULT 'truncate_cascade';--> statement-breakpoint
DROP TYPE "public"."overlay_fit_overflow_old";
