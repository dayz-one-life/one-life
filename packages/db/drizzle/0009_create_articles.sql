CREATE TABLE IF NOT EXISTS "articles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"slug" text,
	"server_id" integer NOT NULL,
	"gamertag" text NOT NULL,
	"map" text NOT NULL,
	"map_slug" text,
	"life_number" integer NOT NULL,
	"life_started_at" timestamp with time zone NOT NULL,
	"death_at" timestamp with time zone NOT NULL,
	"time_alive_seconds" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"longest_kill_meters" double precision,
	"cause" text,
	"headline" text,
	"lede" text,
	"body" text,
	"pull_quote_text" text,
	"pull_quote_attribution" text,
	"tags" text[],
	"facts" jsonb,
	"prompt_version" text,
	"model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"image_url" text,
	"image_prompt" text,
	"image_kind" text,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_kind_server_gamertag_life_uniq" ON "articles" USING btree ("kind","server_id","gamertag","life_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_slug_uniq" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_kind_status_death_idx" ON "articles" USING btree ("kind","status","death_at");