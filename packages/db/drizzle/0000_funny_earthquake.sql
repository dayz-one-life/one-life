CREATE TABLE IF NOT EXISTS "adm_files" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"log_date" timestamp with time zone,
	"last_processed_line" integer DEFAULT 0 NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"last_pulled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "build_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"gamertag" text NOT NULL,
	"player_id" bigint,
	"life_id" bigint,
	"action" text NOT NULL,
	"object" text NOT NULL,
	"class_name" text,
	"tool" text,
	"x" double precision,
	"y" double precision,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consumer_cursors" (
	"consumer_name" text PRIMARY KEY NOT NULL,
	"last_event_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"adm_file_id" bigint NOT NULL,
	"line_index" integer NOT NULL,
	"sub_index" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"raw_line_id" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"victim_gamertag" text NOT NULL,
	"victim_player_id" bigint,
	"attacker_gamertag" text,
	"attacker_type" text NOT NULL,
	"attacker_label" text,
	"body_part" text,
	"victim_hp" double precision,
	"x" double precision,
	"y" double precision,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kills" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"killer_gamertag" text NOT NULL,
	"killer_player_id" bigint,
	"victim_gamertag" text NOT NULL,
	"victim_player_id" bigint,
	"victim_life_id" bigint,
	"weapon" text,
	"distance" double precision,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lives" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"life_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"death_cause" text,
	"death_by_gamertag" text,
	"death_weapon" text,
	"death_distance" double precision,
	"energy_at_death" double precision,
	"water_at_death" double precision,
	"bleed_sources_at_death" integer,
	"playtime_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"gamertag" text NOT NULL,
	"dayz_id" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"current_life_id" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"gamertag" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"adm_file_id" bigint NOT NULL,
	"line_index" integer NOT NULL,
	"occurred_at" timestamp with time zone,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "servers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "servers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nitrado_service_id" bigint NOT NULL,
	"name" text NOT NULL,
	"map" text DEFAULT 'chernarusplus' NOT NULL,
	"slug" text,
	"active" boolean DEFAULT true NOT NULL,
	"clock_offset_ms" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"player_id" bigint NOT NULL,
	"life_id" bigint NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"disconnected_at" timestamp with time zone,
	"duration_seconds" integer,
	"close_reason" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adm_files" ADD CONSTRAINT "adm_files_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "build_events" ADD CONSTRAINT "build_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_adm_file_id_adm_files_id_fk" FOREIGN KEY ("adm_file_id") REFERENCES "public"."adm_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_raw_line_id_raw_lines_id_fk" FOREIGN KEY ("raw_line_id") REFERENCES "public"."raw_lines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hit_events" ADD CONSTRAINT "hit_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kills" ADD CONSTRAINT "kills_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lives" ADD CONSTRAINT "lives_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lives" ADD CONSTRAINT "lives_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "players" ADD CONSTRAINT "players_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_lines" ADD CONSTRAINT "raw_lines_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_lines" ADD CONSTRAINT "raw_lines_adm_file_id_adm_files_id_fk" FOREIGN KEY ("adm_file_id") REFERENCES "public"."adm_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_life_id_lives_id_fk" FOREIGN KEY ("life_id") REFERENCES "public"."lives"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "adm_files_server_path_uniq" ON "adm_files" USING btree ("server_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "build_events_natural_uniq" ON "build_events" USING btree ("server_id","gamertag","action","object","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "build_events_player_idx" ON "build_events" USING btree ("server_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_idempotency_uniq" ON "events" USING btree ("server_id","adm_file_id","line_index","sub_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_server_occurred_idx" ON "events" USING btree ("server_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hit_events_natural_uniq" ON "hit_events" USING btree ("server_id","victim_gamertag","attacker_gamertag","attacker_type","body_part","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kills_victim_life_uniq" ON "kills" USING btree ("server_id","victim_life_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kills_killer_idx" ON "kills" USING btree ("server_id","killer_gamertag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lives_player_idx" ON "lives" USING btree ("server_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_server_gamertag_uniq" ON "players" USING btree ("server_id","gamertag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_player_idx" ON "positions" USING btree ("server_id","player_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_lines_file_line_uniq" ON "raw_lines" USING btree ("adm_file_id","line_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "servers_nitrado_service_id_uniq" ON "servers" USING btree ("nitrado_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "servers_slug_uniq" ON "servers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_open_idx" ON "sessions" USING btree ("server_id","player_id","disconnected_at");