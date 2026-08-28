-- Manual rollback for 0072_overlay_fit_truncate_cascade.sql. Recreates
-- `overlay_fit_overflow` without 'truncate_cascade' and restores the
-- 'proportional' default. Run by hand (drizzle-kit is forward-only):
--   psql "$DATABASE_URL" -f src/db/migrations/0072_overlay_fit_truncate_cascade.rollback.sql
--
-- An instance set to 'truncate_cascade' falls back to 'proportional'.
UPDATE "ap_instance" SET "overlay_fit_overflow" = 'proportional' WHERE "overlay_fit_overflow" = 'truncate_cascade';--> statement-breakpoint
ALTER TABLE "ap_instance" ALTER COLUMN "overlay_fit_overflow" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."overlay_fit_overflow" RENAME TO "overlay_fit_overflow_old";--> statement-breakpoint
CREATE TYPE "public"."overlay_fit_overflow" AS ENUM('proportional', 'grow_window', 'eat_pilot', 'eat_name', 'eat_type');--> statement-breakpoint
ALTER TABLE "ap_instance" ALTER COLUMN "overlay_fit_overflow" TYPE "public"."overlay_fit_overflow" USING "overlay_fit_overflow"::text::"public"."overlay_fit_overflow";--> statement-breakpoint
ALTER TABLE "ap_instance" ALTER COLUMN "overlay_fit_overflow" SET DEFAULT 'proportional';--> statement-breakpoint
DROP TYPE "public"."overlay_fit_overflow_old";
