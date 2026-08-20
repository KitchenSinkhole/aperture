-- Tenancy for manual structure intel. `ap_structure` / `ap_structure_event`
-- carry no `map_id` and, before this migration, no owner at all: every
-- authenticated character could read every row and rewrite or delete any of them
-- by walking the bigserial ids. The `scope` + `scope_*` triple names who may see
-- a row, derived from the map it was written on.
--
-- The `scope` columns are added nullable, backfilled, and only then set NOT NULL
-- — `ADD COLUMN … NOT NULL` without a default fails on a populated table.
--
-- Rollback: src/db/migrations/0070_intel_scope.rollback.sql.
CREATE TYPE "public"."intel_scope" AS ENUM('private', 'corp', 'alliance');--> statement-breakpoint
ALTER TABLE "ap_structure" ADD COLUMN "scope" "intel_scope";--> statement-breakpoint
ALTER TABLE "ap_structure" ADD COLUMN "scope_character_id" bigint;--> statement-breakpoint
ALTER TABLE "ap_structure" ADD COLUMN "scope_corporation_id" bigint;--> statement-breakpoint
ALTER TABLE "ap_structure" ADD COLUMN "scope_alliance_id" bigint;--> statement-breakpoint
ALTER TABLE "ap_structure_event" ADD COLUMN "scope" "intel_scope";--> statement-breakpoint
ALTER TABLE "ap_structure_event" ADD COLUMN "scope_character_id" bigint;--> statement-breakpoint
ALTER TABLE "ap_structure_event" ADD COLUMN "scope_corporation_id" bigint;--> statement-breakpoint
ALTER TABLE "ap_structure_event" ADD COLUMN "scope_alliance_id" bigint;--> statement-breakpoint

-- Backfill: existing rows take the deployment's own owner entity, so everyone
-- inside it keeps seeing exactly what they see today. `access_principal` and
-- `intel_scope` do not share spellings ('corporation' vs 'corp'), hence the CASE
-- rather than a cast. An unowned deployment cannot be resolved to an owner and
-- must not be guessed at, so a deployment holding intel with no owner registered
-- aborts. A deployment with no intel rows has nothing to derive and skips the
-- block: `ap_instance_owner` is populated through /setup, which needs the schema
-- to exist, so a fresh install always migrates against two empty tables.
DO $$
DECLARE
  owner_kind "public"."access_principal";
  owner_id bigint;
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM "ap_structure")
       OR EXISTS (SELECT 1 FROM "ap_structure_event")) THEN
    RETURN;
  END IF;

  SELECT "principal_kind", "principal_id"
    INTO owner_kind, owner_id
    FROM "ap_instance_owner"
   ORDER BY ("principal_kind" = 'alliance') DESC, "principal_id"
   LIMIT 1;

  IF owner_kind IS NULL THEN
    RAISE EXCEPTION 'ap_instance_owner is empty; cannot derive an intel scope for existing ap_structure rows. Register the deployment owner via /setup, then re-run this migration.';
  END IF;

  UPDATE "ap_structure"
     SET "scope" = CASE owner_kind WHEN 'alliance' THEN 'alliance'::"public"."intel_scope"
                                   ELSE 'corp'::"public"."intel_scope" END,
         "scope_corporation_id" = CASE WHEN owner_kind = 'corporation' THEN owner_id END,
         "scope_alliance_id" = CASE WHEN owner_kind = 'alliance' THEN owner_id END
   WHERE "scope" IS NULL;

  UPDATE "ap_structure_event"
     SET "scope" = CASE owner_kind WHEN 'alliance' THEN 'alliance'::"public"."intel_scope"
                                   ELSE 'corp'::"public"."intel_scope" END,
         "scope_corporation_id" = CASE WHEN owner_kind = 'corporation' THEN owner_id END,
         "scope_alliance_id" = CASE WHEN owner_kind = 'alliance' THEN owner_id END
   WHERE "scope" IS NULL;
END $$;--> statement-breakpoint

ALTER TABLE "ap_structure" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_structure_event" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_structure" ADD CONSTRAINT "ap_structure_scope_character_id_ap_character_id_fk" FOREIGN KEY ("scope_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_structure_event" ADD CONSTRAINT "ap_structure_event_scope_character_id_ap_character_id_fk" FOREIGN KEY ("scope_character_id") REFERENCES "public"."ap_character"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_structure_scope_idx" ON "ap_structure" USING btree ("scope","scope_corporation_id","scope_alliance_id","scope_character_id");--> statement-breakpoint
CREATE INDEX "ap_structure_event_scope_idx" ON "ap_structure_event" USING btree ("scope","scope_corporation_id","scope_alliance_id","scope_character_id");--> statement-breakpoint
ALTER TABLE "ap_structure" ADD CONSTRAINT "ap_structure_scope_matches_owner_chk" CHECK (("ap_structure"."scope" = 'private' and "ap_structure"."scope_corporation_id" is null and "ap_structure"."scope_alliance_id" is null)
          or ("ap_structure"."scope" = 'corp' and "ap_structure"."scope_character_id" is null and "ap_structure"."scope_corporation_id" is not null and "ap_structure"."scope_alliance_id" is null)
          or ("ap_structure"."scope" = 'alliance' and "ap_structure"."scope_character_id" is null and "ap_structure"."scope_corporation_id" is null and "ap_structure"."scope_alliance_id" is not null));--> statement-breakpoint
ALTER TABLE "ap_structure_event" ADD CONSTRAINT "ap_structure_event_scope_matches_owner_chk" CHECK (("ap_structure_event"."scope" = 'private' and "ap_structure_event"."scope_corporation_id" is null and "ap_structure_event"."scope_alliance_id" is null)
          or ("ap_structure_event"."scope" = 'corp' and "ap_structure_event"."scope_character_id" is null and "ap_structure_event"."scope_corporation_id" is not null and "ap_structure_event"."scope_alliance_id" is null)
          or ("ap_structure_event"."scope" = 'alliance' and "ap_structure_event"."scope_character_id" is null and "ap_structure_event"."scope_corporation_id" is null and "ap_structure_event"."scope_alliance_id" is not null));
