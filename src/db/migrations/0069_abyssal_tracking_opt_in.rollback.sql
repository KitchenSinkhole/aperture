-- Restores the old default. Per-map values cleared by the forward migration are
-- not recoverable — they carried no intent.
ALTER TABLE "ap_map" ALTER COLUMN "track_abyssal_jumps" SET DEFAULT true;
