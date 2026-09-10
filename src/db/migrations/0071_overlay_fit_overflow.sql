-- Overflow policy for the system overlay's "fit columns to content" action.
--
-- The overlay's pilot table has resizable columns whose widths are remembered
-- per browser (localStorage). Fitting them to their content can ask for more
-- width than the overlay window has; this instance-wide setting decides who
-- gives up the difference. `proportional` (the default) spreads it across every
-- resizable column, `grow_window` widens the Document PiP window instead, and
-- the three `eat_*` values make one named column absorb all of it.
--
-- Rollback: src/db/migrations/0071_overlay_fit_overflow.rollback.sql.
CREATE TYPE "public"."overlay_fit_overflow" AS ENUM('proportional', 'grow_window', 'eat_pilot', 'eat_name', 'eat_type');--> statement-breakpoint
ALTER TABLE "ap_instance" ADD COLUMN "overlay_fit_overflow" "overlay_fit_overflow" DEFAULT 'proportional' NOT NULL;
