CREATE TABLE "user_preferences" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "share_presence" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "a_notify_presence" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "b_notify_presence" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "a_shares_presence" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "b_shares_presence" SET DEFAULT true;
--> statement-breakpoint
UPDATE "friendships" SET "a_shares_presence" = true, "b_shares_presence" = true;
