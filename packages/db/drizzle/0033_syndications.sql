CREATE TABLE IF NOT EXISTS "syndications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"channel" text NOT NULL,
	"posted_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "syndications_slug_channel_uniq" ON "syndications" USING btree ("slug","channel");
