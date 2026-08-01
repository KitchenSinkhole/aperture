CREATE TABLE "ap_character_presence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"character_id" bigint NOT NULL,
	"corporation_id" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_character_presence_interval_ck" CHECK ("ap_character_presence"."ended_at" >= "ap_character_presence"."started_at")
);
--> statement-breakpoint
ALTER TABLE "ap_character_presence" ADD CONSTRAINT "ap_character_presence_character_id_ap_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."ap_character"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_character_presence_character_idx" ON "ap_character_presence" USING btree ("character_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ap_character_presence_corp_idx" ON "ap_character_presence" USING btree ("corporation_id","started_at" DESC NULLS LAST);