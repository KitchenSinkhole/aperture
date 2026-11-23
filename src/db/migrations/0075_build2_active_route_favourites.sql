CREATE TABLE "ap_map_active_route" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"map_id" bigint NOT NULL,
	"owner_user_id" integer NOT NULL,
	"primary_character_id" bigint NOT NULL,
	"destination_system_id" integer NOT NULL,
	"plan_json" jsonb NOT NULL,
	"follower_character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"waypoint_cursor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_map_route_favourite" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"map_id" bigint NOT NULL,
	"user_id" integer NOT NULL,
	"system_id" integer NOT NULL,
	"label" text,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_map_route_favourite_map_user_system_key" UNIQUE("map_id","user_id","system_id")
);
--> statement-breakpoint
ALTER TABLE "ap_map_active_route" ADD CONSTRAINT "ap_map_active_route_map_id_ap_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."ap_map"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_active_route" ADD CONSTRAINT "ap_map_active_route_owner_user_id_ap_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."ap_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_active_route" ADD CONSTRAINT "ap_map_active_route_primary_character_id_ap_character_id_fk" FOREIGN KEY ("primary_character_id") REFERENCES "public"."ap_character"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_active_route" ADD CONSTRAINT "ap_map_active_route_destination_system_id_universe_system_id_fk" FOREIGN KEY ("destination_system_id") REFERENCES "public"."universe_system"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_route_favourite" ADD CONSTRAINT "ap_map_route_favourite_map_id_ap_map_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."ap_map"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_route_favourite" ADD CONSTRAINT "ap_map_route_favourite_user_id_ap_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ap_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_map_route_favourite" ADD CONSTRAINT "ap_map_route_favourite_system_id_universe_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."universe_system"("id") ON DELETE restrict ON UPDATE no action;