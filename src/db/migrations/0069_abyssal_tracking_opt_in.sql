-- `track_abyssal_jumps` was inert from its introduction (migration 0004) until
-- the fold landed, so an existing `true` records no user intent — only the old
-- default. Clearing every row keeps abyssal folding opt-in rather than turning
-- it on for every map at deploy.
ALTER TABLE "ap_map" ALTER COLUMN "track_abyssal_jumps" SET DEFAULT false;--> statement-breakpoint
UPDATE "ap_map" SET "track_abyssal_jumps" = false;
