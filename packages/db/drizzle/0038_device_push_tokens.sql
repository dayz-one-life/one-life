CREATE TABLE IF NOT EXISTS "device_push_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"device_id" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_push_tokens_token_uniq" ON "device_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_push_tokens_user_idx" ON "device_push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_push_tokens_user_device_idx" ON "device_push_tokens" USING btree ("user_id","device_id");
