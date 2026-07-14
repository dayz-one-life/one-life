CREATE TABLE IF NOT EXISTS "character_sightings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"rpt_file_id" bigint NOT NULL,
	"line_index" integer NOT NULL,
	"uid" text NOT NULL,
	"gamertag" text NOT NULL,
	"char_id" bigint NOT NULL,
	"player_db_id" bigint,
	"kind" text NOT NULL,
	"character_class" text,
	"class_source" text,
	"x" double precision,
	"y" double precision,
	"z" double precision,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"char_id" bigint NOT NULL,
	"uid" text NOT NULL,
	"character_class" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rpt_files" (
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
DO $$ BEGIN
 ALTER TABLE "character_sightings" ADD CONSTRAINT "character_sightings_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_sightings" ADD CONSTRAINT "character_sightings_rpt_file_id_rpt_files_id_fk" FOREIGN KEY ("rpt_file_id") REFERENCES "public"."rpt_files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rpt_files" ADD CONSTRAINT "rpt_files_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "character_sightings_file_line_uniq" ON "character_sightings" USING btree ("server_id","rpt_file_id","line_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_sightings_gamertag_idx" ON "character_sightings" USING btree ("server_id","gamertag","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "characters_server_char_epoch_uniq" ON "characters" USING btree ("server_id","char_id","first_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_char_idx" ON "characters" USING btree ("server_id","char_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rpt_files_server_path_uniq" ON "rpt_files" USING btree ("server_id","path");