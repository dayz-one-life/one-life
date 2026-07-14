CREATE TABLE IF NOT EXISTS "bans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"gamertag" text NOT NULL,
	"life_started_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"qualified_by" text,
	"banned_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"dry_run" boolean NOT NULL,
	"applied_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bans" ADD CONSTRAINT "bans_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bans_server_gamertag_life_uniq" ON "bans" USING btree ("server_id","gamertag","life_started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bans_status_idx" ON "bans" USING btree ("status");