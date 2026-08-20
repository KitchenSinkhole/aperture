CREATE UNLOGGED TABLE "universe_sde_stage" (
	"run_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"id_a" integer NOT NULL,
	"id_b" integer
);
--> statement-breakpoint
CREATE INDEX "universe_sde_stage_key_idx" ON "universe_sde_stage" USING btree ("run_id","table_name","id_a","id_b");