CREATE TABLE IF NOT EXISTS "avatar_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reporter_user_id" text NOT NULL,
	"subject_user_id" text NOT NULL,
	"subject_hash" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocked_avatar_hashes" (
	"hash" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'auto' NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_blocks" (
	"blocker_user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_user_id_blocked_user_id_pk" PRIMARY KEY("blocker_user_id","blocked_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avatar_reports" ADD CONSTRAINT "avatar_reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "avatar_reports" ADD CONSTRAINT "avatar_reports_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_user_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_user_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "avatar_reports_reporter_subject_uniq" ON "avatar_reports" USING btree ("reporter_user_id","subject_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avatar_reports_hash_idx" ON "avatar_reports" USING btree ("subject_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avatar_reports_reporter_created_idx" ON "avatar_reports" USING btree ("reporter_user_id","created_at");