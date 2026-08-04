-- Rollback of 0064_sde_behind_since.sql.

ALTER TABLE "ap_sde_state" DROP COLUMN "behind_since";
