-- Connection confirmation state — `ap_map_connection.confirmed_at`.
--
-- A wormhole connection is only as valid as a current sig observation. Removing
-- a system soft-deletes it (`visible = false`) but leaves its connection rows
-- intact, so the read-time "both endpoints visible" filter would resurrect an
-- unconfirmed `wh` edge on reload that nobody re-scanned. `confirmed_at` is the
-- "confirmed by a current observation" state: set to now() on every create
-- (manual draw, sig link, stargate auto-link) and NULLed on a `wh` connection
-- when an endpoint is removed (dormant memory — kept for an in-place restore,
-- hidden from the view). `loadMapForView` only loads connections with a non-null
-- `confirmed_at`.
--
-- Convention deviation (CLAUDE.md: "hard-delete for ap_map_connection", "no
-- generic active boolean"): this is a meaningful timestamp (like
-- last_visible_at / deleted_at), not a boolean, and dormancy applies only to the
-- endpoint-removal path for `wh`-scope rows. Genuine collapse (deleteConnection)
-- still hard-deletes and cascades the sig. stargate/jumpbridge/abyssal are
-- structural — never sig-confirmed, never dormanted.
--
-- Rollback: src/db/migrations/0042_connection_confirmed_at.rollback.sql.

ALTER TABLE "ap_map_connection" ADD COLUMN "confirmed_at" timestamptz;--> statement-breakpoint
-- Backfill so nothing vanishes on deploy: every existing row is treated as confirmed.
UPDATE "ap_map_connection" SET "confirmed_at" = "created_at" WHERE "confirmed_at" IS NULL;
